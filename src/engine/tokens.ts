export const TOKEN_CHARACTER_PATTERN = String.raw`[\p{L}\p{N}_'’\u2010\u2011-]`
export const TOKEN_RUN_PATTERN = new RegExp(`${TOKEN_CHARACTER_PATTERN}+`, "gu")
