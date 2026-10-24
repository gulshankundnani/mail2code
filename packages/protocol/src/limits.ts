// Hard limits shared by the extension and the bridge. Chrome caps host->browser
// native messages at 1 MB, so anything the bridge sends must stay well below it.
export const LIMITS = {
  maxMessagesPerHandoff: 50,
  maxMessageBodyChars: 200_000,
  maxHandoffChars: 2_000_000,
  maxInstructionsChars: 20_000,
  maxSubjectChars: 1_000,
  maxTitleChars: 300,
  maxPlanChars: 200_000,
  maxHostToBrowserBytes: 900_000,
} as const;
