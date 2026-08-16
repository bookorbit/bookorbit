import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import { createMigrationSourceDraft } from '@/features/migration/lib/migration-source-config'
import MigrationSourceFields from './MigrationSourceFields.vue'

function mountFields(type = 'audiobookshelf', wide = false) {
  const draft = reactive(createMigrationSourceDraft(type))
  const wrapper = mount(MigrationSourceFields, {
    props: {
      draft,
      supportedTypes: ['booklore', 'grimmory', 'audiobookshelf', 'calibre_web_automated'],
      disabled: false,
      showSecret: false,
      testingMediaPath: false,
      mediaPathTestState: 'idle',
      mediaPathTestMessage: null,
      mediaRootPathHint: { className: 'text-muted-foreground', text: 'hint' },
      wide,
    },
  })
  return { draft, wrapper }
}

describe('MigrationSourceFields', () => {
  it('renders translated source type labels instead of internal identifiers', () => {
    const { wrapper } = mountFields()
    const options = wrapper.findAll('option').map((option) => option.text())

    expect(options).toEqual(['Booklore', 'Grimmory', 'Audiobookshelf', 'Calibre-Web Automated'])
    expect(wrapper.text()).not.toContain('calibre_web_automated')
  })

  it('shows live API fields and keeps the secret control keyboard reachable', async () => {
    const { draft, wrapper } = mountFields()

    expect(wrapper.get('input[type="url"]').attributes('placeholder')).toContain('audiobookshelf.local')
    expect(wrapper.text()).toContain('API token')
    expect(wrapper.text()).toContain('Allow private network access')
    expect(wrapper.find('input[placeholder="/imports/audiobookshelf/backup.audiobookshelf"]').exists()).toBe(false)

    const secretButton = wrapper.get('button[aria-label="Show secret"]')
    expect(secretButton.element.tagName).toBe('BUTTON')
    expect(secretButton.attributes('tabindex')).toBeUndefined()
    await secretButton.trigger('click')
    expect(wrapper.emitted('toggleSecret')).toHaveLength(1)

    await wrapper.get('input[type="checkbox"]').setValue(true)
    expect(draft.allowPrivateNetwork).toBe(true)
  })

  it('switches to a backup form and hides API-only controls', async () => {
    const { draft, wrapper } = mountFields()

    await wrapper.get('input[type="radio"][value="backup"]').setValue()

    expect(draft.audiobookshelfMode).toBe('backup')
    expect(wrapper.get('input[placeholder="/imports/audiobookshelf/backup.audiobookshelf"]')).toBeTruthy()
    expect(wrapper.find('input[type="url"]').exists()).toBe(false)
    expect(wrapper.find('button[aria-label="Show secret"]').exists()).toBe(false)
  })

  it('uses responsive grid semantics in the wider settings entry point', () => {
    const { wrapper } = mountFields('audiobookshelf', true)

    expect(wrapper.get('[data-testid="migration-source-fields"]').classes()).toEqual(
      expect.arrayContaining(['grid', 'md:grid-cols-2', 'xl:grid-cols-4']),
    )
    expect(wrapper.get('fieldset').classes()).toContain('md:col-span-2')
  })

  it('shows only the two CWA snapshot paths with accessible guidance in the narrow entry point', () => {
    const { wrapper } = mountFields('calibre_web_automated')
    const fields = wrapper.get('[data-testid="migration-source-fields"]')
    const inputs = wrapper.findAll('input')
    const appDatabaseInput = wrapper.get('input[placeholder="/imports/calibre-web-automated/app.db"]')
    const metadataDatabaseInput = wrapper.get('input[placeholder="/imports/calibre-web-automated/metadata.db"]')

    expect(fields.classes()).toEqual(expect.arrayContaining(['grid', 'md:grid-cols-2']))
    expect(fields.classes()).not.toContain('grid-cols-2')
    expect(inputs).toHaveLength(3)
    expect(wrapper.find('input[type="url"]').exists()).toBe(false)
    expect(wrapper.find('input[placeholder="127.0.0.1"]').exists()).toBe(false)
    expect(wrapper.find('input[placeholder="/imports/audiobookshelf/backup.audiobookshelf"]').exists()).toBe(false)

    expect(appDatabaseInput.element.closest('label')?.textContent).toContain('Calibre-Web Automated app.db snapshot')
    expect(metadataDatabaseInput.element.closest('label')?.textContent).toContain('Calibre metadata.db snapshot')
    expect(appDatabaseInput.attributes('aria-describedby')).toBe('cwa-snapshot-guidance')
    expect(metadataDatabaseInput.attributes('aria-describedby')).toBe('cwa-snapshot-guidance')
    expect(appDatabaseInput.attributes('tabindex')).toBeUndefined()
    expect(metadataDatabaseInput.attributes('tabindex')).toBeUndefined()
    expect(appDatabaseInput.classes()).toContain('input-field')
    expect(metadataDatabaseInput.classes()).toContain('input-field')

    const guidance = wrapper.get('#cwa-snapshot-guidance')
    expect(guidance.attributes('aria-labelledby')).toBe('cwa-snapshot-guidance-title')
    expect(guidance.text()).toContain('Stop Calibre-Web Automated before copying both databases')
    expect(guidance.text()).toContain('MIGRATION_IMPORT_ROOT')
    expect(guidance.text()).toContain('logical Calibre library root stored in app.db')
    expect(guidance.text()).toContain('v4.0.6')
    expect(guidance.classes()).toContain('md:col-span-2')
  })

  it('spans CWA guidance and snapshot paths responsively in the wide entry point', () => {
    const { wrapper } = mountFields('calibre_web_automated', true)
    const guidance = wrapper.get('#cwa-snapshot-guidance')
    const appDatabaseLabel = wrapper.get('input[placeholder="/imports/calibre-web-automated/app.db"]').element.closest('label')
    const metadataDatabaseLabel = wrapper.get('input[placeholder="/imports/calibre-web-automated/metadata.db"]').element.closest('label')

    expect(wrapper.get('[data-testid="migration-source-fields"]').classes()).toEqual(expect.arrayContaining(['md:grid-cols-2', 'xl:grid-cols-4']))
    expect(guidance.classes()).toEqual(expect.arrayContaining(['md:col-span-2', 'xl:col-span-4']))
    expect(appDatabaseLabel?.classList.contains('md:col-span-2')).toBe(true)
    expect(metadataDatabaseLabel?.classList.contains('md:col-span-2')).toBe(true)
  })

  it('keeps database fields and media path testing for Booklore-compatible sources', async () => {
    const { wrapper } = mountFields('booklore')

    expect(wrapper.get('input[placeholder="127.0.0.1"]')).toBeTruthy()
    expect(wrapper.text()).toContain('Media Root Path')
    expect(wrapper.text()).not.toContain('Connection mode')

    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('toggleSecret')).toHaveLength(1)
    const testPathButton = wrapper.findAll('button').find((button) => button.text().includes('Test Path'))
    expect(testPathButton).toBeDefined()
    await testPathButton?.trigger('click')
    expect(wrapper.emitted('testMediaPath')).toHaveLength(1)
  })
})
