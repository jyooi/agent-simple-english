export const DICTIONARY_TOKEN_SOURCE = String.raw`[\p{L}\p{N}]+(?:['’\u2010\u2011-][\p{L}\p{N}]+)*`

export const DICTIONARY_WORD_PATTERN = new RegExp(`^${DICTIONARY_TOKEN_SOURCE}$`, "u")

export const DICTIONARY_FORM_PATTERN = new RegExp(
  `^${DICTIONARY_TOKEN_SOURCE}(?:[\t ]+${DICTIONARY_TOKEN_SOURCE})*$`,
  "u",
)
