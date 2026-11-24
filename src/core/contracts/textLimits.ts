export const TEXT_LIMITS = {
  NAME: 300,
  SHORT_LABEL: 120,
  TITLE: 500,
  DESCRIPTION: 4000,
  ADDRESS: 600,
  NOTES: 5000,
  DEVIATION_REASON: 1000,
  SHARE_MESSAGE: 5000,
  CHAT_INPUT: 12000,
  RAG_SNIPPET: 240,
  DISAMBIGUATION_LABEL: 160,
  TAX_ID: 32,
  PHONE: 40,
  EMAIL: 200,
  PAYMENT_LABEL: 120,
} as const;

export function truncateText(value: string, maxLen: number): string {
  if (maxLen <= 0) return "";
  if (value.length <= maxLen) return value;
  if (maxLen === 1) return value.slice(0, 1);
  return `${value.slice(0, maxLen - 1)}…`;
}
