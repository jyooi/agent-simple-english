export const TOKEN_CHARACTER_PATTERN = "[A-Za-z0-9_'’-]"
export const TOKEN_RUN_PATTERN = new RegExp(`${TOKEN_CHARACTER_PATTERN}+`, "g")
