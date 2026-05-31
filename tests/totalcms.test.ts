import { describe, expect, it } from 'vitest'
import { totalcmsConnector } from '../src/connectors/adapters/totalcms.js'

describe('totalcms adapter manifest', () => {
  it('classifies itself as the crm category and exposes the totalcms kind', () => {
    expect(totalcmsConnector.manifest.kind).toBe('totalcms')
    expect(totalcmsConnector.manifest.category).toBe('crm')
    expect(totalcmsConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth', () => {
    const auth = totalcmsConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (content, posts, media, data, depot)', () => {
    const names = totalcmsConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'posts.get_blog_post',
        'content.get_content',
        'posts.save_blog_post',
        'content.save_content',
        'media.save_image',
        'media.save_blog_image',
        'media.save_video',
        'media.save_gallery',
        'media.save_blog_gallery',
        'data.save_file',
        'data.save_text',
        'data.save_toggle',
        'data.save_date',
        'depot.save_depot',
      ].sort(),
    )
    const reads = totalcmsConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = totalcmsConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['content.get_content', 'posts.get_blog_post'].sort())
    expect(mutations).toEqual(
      [
        'content.save_content',
        'data.save_date',
        'data.save_file',
        'data.save_text',
        'data.save_toggle',
        'depot.save_depot',
        'media.save_blog_gallery',
        'media.save_blog_image',
        'media.save_gallery',
        'media.save_image',
        'media.save_video',
        'posts.save_blog_post',
      ].sort(),
    )
  })
})
