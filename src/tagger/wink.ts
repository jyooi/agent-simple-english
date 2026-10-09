import model from "wink-eng-lite-web-model"
import winkNLP, { type ItemToken, type ItsFunction } from "wink-nlp"
import type { TaggedToken, Tagger } from "../engine/tagger.ts"

export function makeWinkTagger(): Tagger {
  const nlp = winkNLP(model, ["sbd", "pos"])
  const its = nlp.its
  const lemmaWithTypeThatTokenOutAccepts = its.lemma as unknown as ItsFunction<string>
  return (text) => {
    const doc = nlp.readDoc(text)
    const tokens: TaggedToken[] = []
    let scanCursor = 0
    doc.tokens().each((token: ItemToken) => {
      const value = token.out(its.value)
      const found = text.indexOf(value, scanCursor)
      const offset = found === -1 ? scanCursor : found
      tokens.push({
        text: value,
        pos: token.out(its.pos),
        lemma: token.out(lemmaWithTypeThatTokenOutAccepts),
        offset,
      })
      scanCursor = offset + value.length
    })
    return tokens
  }
}

export const makeLazyWinkTagger = (): Tagger => {
  let tagger: Tagger | undefined
  return (text) => {
    tagger ??= makeWinkTagger()
    return tagger(text)
  }
}
