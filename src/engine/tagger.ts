export interface TaggedToken {
  readonly text: string
  readonly pos: string
  readonly lemma: string
  readonly offset: number
}

export type Tagger = (text: string) => readonly TaggedToken[]
