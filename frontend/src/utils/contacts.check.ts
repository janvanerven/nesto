// Dev-only self-check: npx --yes tsx src/utils/contacts.check.ts (never imported, not bundled)
import assert from 'node:assert/strict'
import { envelopeText, mapUrl, matchesContactSearch, suggestLabel } from './contacts'

const addr = { label: 'Home', street: 'Dorpsstraat 1', postcode: '1234 AB', city: 'Dorp', country: '' }

assert.equal(matchesContactSearch('zoe', null, [{ name: 'Zoë' }]), true)
assert.equal(matchesContactSearch('dorpsstr', addr, []), true)
assert.equal(matchesContactSearch('  ', null, []), true)
assert.equal(matchesContactSearch('nope', addr, [{ name: 'Zoë' }]), false)
assert.equal(envelopeText(addr).split('\n').length, 3)
assert.equal(envelopeText({ ...addr, country: 'NL' }), 'Home\nDorpsstraat 1\n1234 AB Dorp\nNL')
assert.equal(mapUrl(addr), 'https://maps.apple.com/?q=' + encodeURIComponent('Dorpsstraat 1, 1234 AB Dorp'))
assert.equal(suggestLabel([{ name: 'Mark' }]), 'Mark')
assert.equal(suggestLabel([{ name: 'Mark' }, { name: 'Lisa' }]), 'Mark & Lisa')
assert.equal(suggestLabel([{ name: 'Mark' }, { name: 'Lisa' }, { name: 'Noor' }]), 'Mark, Lisa & Noor')
console.log('ok')
