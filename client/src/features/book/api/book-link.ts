import type { BookLinkGroup, BookLinkLeadRequest, BookLinkRequest } from '@bookorbit/types'
import { apiJson, apiSend, jsonBody } from '@/lib/api-json'

export function linkBooks(body: BookLinkRequest): Promise<BookLinkGroup> {
  return apiJson('/api/v1/books/links', jsonBody('POST', body), 'book.link.errors.linkFailed')
}

export function setBookLinkLead(groupId: number, body: BookLinkLeadRequest): Promise<BookLinkGroup> {
  return apiJson(`/api/v1/books/links/${groupId}`, jsonBody('PATCH', body), 'book.link.errors.leadFailed')
}

export function unlinkBook(bookId: number): Promise<void> {
  return apiSend(`/api/v1/books/${bookId}/link`, { method: 'DELETE' }, 'book.link.errors.unlinkFailed')
}
