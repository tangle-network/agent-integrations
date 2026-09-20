import assert from 'node:assert/strict'
import { parse } from 'csv-parse/sync'
import { expect, it } from 'vitest'

it('keeps duplicate prototype column names as own data properties', () => {
  // GHSA-8cw4-87c7-c6xx: grouped duplicate headers must not replace the record prototype.
  const [record] = parse('__proto__,__proto__,name\nfirst,second,Ada\n', {
    columns: true,
    group_columns_by_name: true,
  })

  assert(record !== null && typeof record === 'object')
  expect(Object.getPrototypeOf(record)).toBe(Object.prototype)
  expect(Object.hasOwn(record, '__proto__')).toBe(true)
  expect(Object.getOwnPropertyDescriptor(record, '__proto__')?.value).toEqual(['first', 'second'])
  expect(record).toMatchObject({ name: 'Ada' })
})
