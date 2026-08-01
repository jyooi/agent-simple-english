import { Context, Layer } from "effect"
import model from "wink-eng-lite-web-model"
import winkNLP, { type ItemToken, type ItsFunction } from "wink-nlp"
import type { TaggedToken, Tagger } from "../engine/tagger.ts"

export function makeWinkTagger(): Tagger {
  const nlp = winkNLP(model, ["sbd", "pos"])
  const its = nlp.its
  // wink-nlp's d.ts declares its.lemma with a signature token.out() rejects;
  // at runtime it is a valid token helper, so cast to the accepted shape.
  const lemma = its.lemma as unknown as ItsFunction<string>
  return (text) => {
    const doc = nlp.readDoc(text)
    const tokens: TaggedToken[] = []
    // wink-nlp does not expose character offsets, so recover them by scanning
    // for each token value in order; values are verbatim slices of the input.
    let cursor = 0
    doc.tokens().each((token: ItemToken) => {
      const value = token.out(its.value)
      const found = text.indexOf(value, cursor)
      const offset = found === -1 ? cursor : found
      tokens.push({
        text: value,
        pos: token.out(its.pos),
        lemma: token.out(lemma),
        offset,
      })
      cursor = offset + value.length
    })
    return tokens
  }
}

export class TaggerService extends Context.Tag("TaggerService")<TaggerService, Tagger>() {}

const makeLazyWinkTagger = (): Tagger => {
  let tagger: Tagger | undefined
  return (text) => {
    tagger ??= makeWinkTagger()
    return tagger(text)
  }
}

export const WinkTaggerLive = Layer.sync(TaggerService, makeLazyWinkTagger)
