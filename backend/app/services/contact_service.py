import uuid

from fastapi import HTTPException
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.contact import ContactAddress, Person
from app.schemas.birthday import validate_birth_date
from app.schemas.contact import (
    AddressCreate,
    AddressResponse,
    AddressUpdate,
    ContactsResponse,
    PersonCreate,
    PersonResponse,
    PersonUpdate,
)
from app.services.birthday_service import _compute_age

_ADDRESS_UPDATABLE_FIELDS = {"label", "street", "postcode", "city", "country", "notes"}
_PERSON_UPDATABLE_FIELDS = {
    "name", "birth_month", "birth_day", "birth_year", "phone", "email", "notes", "address_id",
}
# Columns that can never be cleared with an explicit null
_NOT_NULLABLE = {
    "label", "street", "postcode", "city", "country", "notes", "name", "phone", "email",
}


def _person_to_response(person: Person) -> PersonResponse:
    age = None
    if person.birth_month is not None and person.birth_day is not None:
        age = _compute_age(person.birth_year, person.birth_month, person.birth_day)
    return PersonResponse(
        id=person.id,
        household_id=person.household_id,
        address_id=person.address_id,
        name=person.name,
        birth_month=person.birth_month,
        birth_day=person.birth_day,
        birth_year=person.birth_year,
        age=age,
        phone=person.phone,
        email=person.email,
        notes=person.notes,
        created_at=person.created_at,
        updated_at=person.updated_at,
    )


def _address_to_response(address: ContactAddress, people: list[Person]) -> AddressResponse:
    return AddressResponse(
        id=address.id,
        household_id=address.household_id,
        label=address.label,
        street=address.street,
        postcode=address.postcode,
        city=address.city,
        country=address.country,
        notes=address.notes,
        people=[_person_to_response(p) for p in sorted(people, key=lambda p: p.name.lower())],
        created_at=address.created_at,
        updated_at=address.updated_at,
    )


async def _get_address_or_404(db: AsyncSession, address_id: str, household_id: str) -> ContactAddress:
    result = await db.execute(
        select(ContactAddress).where(
            ContactAddress.id == address_id, ContactAddress.household_id == household_id
        )
    )
    address = result.scalar_one_or_none()
    if not address:
        raise HTTPException(status_code=404, detail="Address not found")
    return address


async def _get_person_or_404(db: AsyncSession, person_id: str, household_id: str) -> Person:
    result = await db.execute(
        select(Person).where(Person.id == person_id, Person.household_id == household_id)
    )
    person = result.scalar_one_or_none()
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    return person


async def _people_of(db: AsyncSession, address_id: str) -> list[Person]:
    result = await db.execute(select(Person).where(Person.address_id == address_id))
    return list(result.scalars().all())


async def list_contacts(db: AsyncSession, household_id: str) -> ContactsResponse:
    addresses = (
        await db.execute(
            select(ContactAddress)
            .where(ContactAddress.household_id == household_id)
            .order_by(func.lower(ContactAddress.label), ContactAddress.id)
        )
    ).scalars().all()
    people = (
        await db.execute(
            select(Person)
            .where(Person.household_id == household_id)
            .order_by(func.lower(Person.name), Person.id)
        )
    ).scalars().all()
    by_address: dict[str, list[Person]] = {}
    unassigned: list[Person] = []
    for person in people:
        if person.address_id:
            by_address.setdefault(person.address_id, []).append(person)
        else:
            unassigned.append(person)
    return ContactsResponse(
        addresses=[_address_to_response(a, by_address.get(a.id, [])) for a in addresses],
        people_without_address=[_person_to_response(p) for p in unassigned],
    )


def _new_person(household_id: str, user_id: str, data: PersonCreate, address_id: str | None) -> Person:
    return Person(
        id=str(uuid.uuid4()),
        household_id=household_id,
        created_by=user_id,
        address_id=address_id,
        **data.model_dump(exclude={"address_id"}),
    )


async def create_address(
    db: AsyncSession, household_id: str, user_id: str, data: AddressCreate
) -> AddressResponse:
    # Validate every referenced person before writing anything
    move_ids = list(dict.fromkeys(data.move_people))
    to_move: list[Person] = []
    if move_ids:
        found = (
            await db.execute(
                select(Person).where(Person.id.in_(move_ids), Person.household_id == household_id)
            )
        ).scalars().all()
        if len(found) != len(move_ids):
            raise HTTPException(status_code=404, detail="Person not found")
        to_move = list(found)

    address = ContactAddress(
        id=str(uuid.uuid4()),
        household_id=household_id,
        created_by=user_id,
        **data.model_dump(exclude={"people", "move_people"}),
    )
    db.add(address)
    new_people = [_new_person(household_id, user_id, p, address.id) for p in data.people]
    db.add_all(new_people)
    for person in to_move:
        person.address_id = address.id
    await db.commit()
    await db.refresh(address)
    return _address_to_response(address, await _people_of(db, address.id))


async def update_address(
    db: AsyncSession, household_id: str, address_id: str, data: AddressUpdate
) -> AddressResponse:
    address = await _get_address_or_404(db, address_id, household_id)
    for key, value in data.model_dump(exclude_unset=True).items():
        if key in _ADDRESS_UPDATABLE_FIELDS and value is not None:
            setattr(address, key, value)
    await db.commit()
    await db.refresh(address)
    return _address_to_response(address, await _people_of(db, address.id))


async def delete_address(
    db: AsyncSession, household_id: str, address_id: str, delete_people: bool
) -> None:
    address = await _get_address_or_404(db, address_id, household_id)
    if delete_people:
        await db.execute(delete(Person).where(Person.address_id == address.id))
    else:
        # Don't rely on ON DELETE SET NULL (SQLite foreign keys may be off)
        await db.execute(update(Person).where(Person.address_id == address.id).values(address_id=None))
    await db.delete(address)
    await db.commit()


async def create_person(
    db: AsyncSession, household_id: str, user_id: str, data: PersonCreate
) -> PersonResponse:
    if data.address_id:
        await _get_address_or_404(db, data.address_id, household_id)
    person = _new_person(household_id, user_id, data, data.address_id)
    db.add(person)
    await db.commit()
    await db.refresh(person)
    return _person_to_response(person)


async def update_person(
    db: AsyncSession, household_id: str, person_id: str, data: PersonUpdate
) -> PersonResponse:
    person = await _get_person_or_404(db, person_id, household_id)
    updates = {
        k: v for k, v in data.model_dump(exclude_unset=True).items()
        if k in _PERSON_UPDATABLE_FIELDS and not (v is None and k in _NOT_NULLABLE)
    }

    month = updates.get("birth_month", person.birth_month)
    day = updates.get("birth_day", person.birth_day)
    year = updates.get("birth_year", person.birth_year)
    if (month is None) != (day is None) or (month is None and year is not None):
        raise HTTPException(status_code=422, detail="birth_month and birth_day must be set together")
    if month is not None:
        try:
            validate_birth_date(month, day, year)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))

    if updates.get("address_id"):
        await _get_address_or_404(db, updates["address_id"], household_id)

    for key, value in updates.items():
        setattr(person, key, value)
    await db.commit()
    await db.refresh(person)
    return _person_to_response(person)


async def delete_person(db: AsyncSession, household_id: str, person_id: str) -> None:
    person = await _get_person_or_404(db, person_id, household_id)
    await db.delete(person)
    await db.commit()
