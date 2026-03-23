from pydantic import BaseModel


class SekuraConnectionCreate(BaseModel):
    api_key: str


class SekuraConnectionResponse(BaseModel):
    configured: bool
    key_scope: str | None = None


class SekuraTestResponse(BaseModel):
    ok: bool
    error: str | None = None


# Sekura API response models (what Sekura returns, mapped for Nesto's frontend)

class SekuraFolder(BaseModel):
    id: str
    name: str
    parent_id: str | None = None
    created_at: str
    item_count: int = 0


class SekuraFolderAncestor(BaseModel):
    id: str
    name: str


class SekuraFile(BaseModel):
    id: str
    name: str
    mime_type: str | None = None
    size: int
    folder_id: str | None = None
    created_at: str
    updated_at: str | None = None


class SekuraFolderContents(BaseModel):
    folder: SekuraFolder | None = None
    ancestors: list[SekuraFolderAncestor] = []
    folders: list[SekuraFolder] = []
    files: list[SekuraFile] = []


class SekuraCreateFolder(BaseModel):
    name: str
    parent_id: str | None = None


class SekuraRenameRequest(BaseModel):
    name: str


class SekuraMoveRequest(BaseModel):
    parent_id: str | None = None


class SekuraFileVersion(BaseModel):
    id: str
    version_number: int
    size: int
    created_at: str


class SekuraTrashItem(BaseModel):
    id: str
    name: str
    type: str  # "file" or "folder"
    deleted_at: str


class SekuraShare(BaseModel):
    id: str
    resource_type: str
    resource_id: str
    shared_with: str
    shared_with_name: str | None = None
    permission: str
    created_at: str


class SekuraCreateShare(BaseModel):
    resource_type: str
    resource_id: str
    shared_with: str
    permission: str


class SekuraUpdateShare(BaseModel):
    permission: str


class SekuraUser(BaseModel):
    id: str
    email: str
    display_name: str | None = None
