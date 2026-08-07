export const DEFAULT_NOTIFICATION_SETTINGS = {
  global: {
    pauseAll: false,
    quietMode: false,
  },
  interactions: {
    likes: true,
    comments: true,
    mentions: true,
    tags: true,
  },
  network: {
    newFollowers: true,
    recommendations: true,
  },
} as const;
