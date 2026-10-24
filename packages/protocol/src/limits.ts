// Hard limits shared across the extension.
export const LIMITS = {
  maxMessagesPerHandoff: 50,
  maxMessageBodyChars: 200_000,
  maxHandoffChars: 2_000_000,
  maxInstructionsChars: 20_000,
  maxSubjectChars: 1_000,
  maxTitleChars: 300,
  maxRepositoryRefChars: 500,
  maxPlanChars: 200_000,
  maxNoteChars: 5_000,
} as const;
