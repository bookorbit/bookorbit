import { ref } from 'vue'
import { api } from '@/lib/api'

export interface EmailTemplate {
  id: number
  userId: number | null
  name: string
  subject: string
  bodyText: string
  isDefault: boolean
  isSystem: boolean
  createdAt: string
}

export interface EmailTemplateForm {
  name: string
  subject: string
  bodyText: string
}

const templates = ref<EmailTemplate[]>([])
let fetchPromise: Promise<void> | null = null

export function useEmailTemplates() {
  async function fetchTemplates(): Promise<void> {
    if (fetchPromise) return fetchPromise
    fetchPromise = api('/api/v1/email/templates')
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load templates')
        templates.value = await res.json()
      })
      .finally(() => {
        fetchPromise = null
      })
    return fetchPromise
  }

  async function createTemplate(form: EmailTemplateForm): Promise<EmailTemplate> {
    const res = await api('/api/v1/email/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as { message?: string }).message ?? 'Failed to create template')
    }
    const created: EmailTemplate = await res.json()
    templates.value = [...templates.value, created]
    return created
  }

  async function updateTemplate(id: number, form: Partial<EmailTemplateForm>): Promise<EmailTemplate> {
    const res = await api(`/api/v1/email/templates/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as { message?: string }).message ?? 'Failed to update template')
    }
    const updated: EmailTemplate = await res.json()
    templates.value = templates.value.map((t) => (t.id === id ? updated : t))
    return updated
  }

  async function deleteTemplate(id: number): Promise<void> {
    const res = await api(`/api/v1/email/templates/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as { message?: string }).message ?? 'Failed to delete template')
    }
    templates.value = templates.value.filter((t) => t.id !== id)
  }

  async function setDefaultTemplate(id: number): Promise<void> {
    const res = await api(`/api/v1/email/templates/${id}/default`, { method: 'PATCH' })
    if (!res.ok) throw new Error('Failed to set default')
    const updated: EmailTemplate = await res.json()
    templates.value = templates.value.map((t) => ({ ...t, isDefault: t.id === updated.id ? updated.isDefault : false }))
  }

  async function previewTemplate(id: number, bookId: number): Promise<{ subject: string; bodyText: string }> {
    const res = await api(`/api/v1/email/templates/${id}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookId }),
    })
    if (!res.ok) throw new Error('Failed to preview template')
    return res.json()
  }

  return { templates, fetchTemplates, createTemplate, updateTemplate, deleteTemplate, setDefaultTemplate, previewTemplate }
}
