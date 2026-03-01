import { ref } from 'vue'
import { api } from '@/lib/api'
import type { EmailRecipient } from './useEmailRecipients'

export interface EmailGroup {
  id: number
  userId: number
  name: string
  defaultTemplateId: number | null
  members: EmailRecipient[]
  createdAt: string
}

const groups = ref<EmailGroup[]>([])
let fetchPromise: Promise<void> | null = null

export function useEmailGroups() {
  async function fetchGroups(): Promise<void> {
    if (fetchPromise) return fetchPromise
    fetchPromise = api('/api/v1/email/recipient-groups')
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load groups')
        groups.value = await res.json()
      })
      .finally(() => {
        fetchPromise = null
      })
    return fetchPromise
  }

  async function createGroup(name: string): Promise<EmailGroup> {
    const res = await api('/api/v1/email/recipient-groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as { message?: string }).message ?? 'Failed to create group')
    }
    const created: EmailGroup = await res.json()
    groups.value = [...groups.value, created]
    return created
  }

  async function deleteGroup(id: number): Promise<void> {
    const res = await api(`/api/v1/email/recipient-groups/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to delete group')
    groups.value = groups.value.filter((g) => g.id !== id)
  }

  async function addMember(groupId: number, recipientId: number): Promise<void> {
    const res = await api(`/api/v1/email/recipient-groups/${groupId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipientId }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as { message?: string }).message ?? 'Failed to add member')
    }
    const updated: EmailGroup = await res.json()
    groups.value = groups.value.map((g) => (g.id === groupId ? updated : g))
  }

  async function removeMember(groupId: number, recipientId: number): Promise<void> {
    const res = await api(`/api/v1/email/recipient-groups/${groupId}/members/${recipientId}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to remove member')
    groups.value = groups.value.map((g) => (g.id === groupId ? { ...g, members: g.members.filter((m) => m.id !== recipientId) } : g))
  }

  return { groups, fetchGroups, createGroup, deleteGroup, addMember, removeMember }
}
