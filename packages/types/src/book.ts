export type BookFileRef = {
  id: number
  format: string | null
  role: string
}

export type BookCard = {
  id: number
  status: string
  title: string | null
  authors: string[]
  seriesName: string | null
  seriesIndex: number | null
  files: BookFileRef[]
}

export type BooksPage = {
  items: BookCard[]
  total: number
  page: number
  size: number
}
