/**
 * An entry in a settings editor's overflow menu. Anything that acts on something other than the
 * record being edited belongs here rather than beside Save, where it reads as part of the form.
 */
export interface EditorMenuAction {
  id: string
  label: string
  /** Drawn as destructive in the menu. Styling only; the confirm step is `confirm`. */
  danger?: boolean
  /** The question the footer asks before running this. Without one it runs on the first click. */
  confirm?: string
  /** What running it costs beyond the obvious, such as what else stops working. */
  consequence?: string
  /** Draws a divider above the entry, to separate the record from what it is built on. */
  separated?: boolean
  disabled?: boolean
}
