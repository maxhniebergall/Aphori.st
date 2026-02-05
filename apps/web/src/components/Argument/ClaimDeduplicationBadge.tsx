'use client';

interface ClaimDeduplicationBadgeProps {
  aduCount: number;
  isExpanded: boolean;
}

export function ClaimDeduplicationBadge({ aduCount, isExpanded }: ClaimDeduplicationBadgeProps) {
  // Only show badge if there are other posts with this claim
  if (aduCount <= 1) {
    return null;
  }

  const otherCount = aduCount - 1;

  return (
    <span
      className={`
        ml-1 inline-flex items-center justify-center
        px-1.5 py-0.5 text-[10px] font-medium rounded-full
        transition-colors cursor-pointer
        ${isExpanded
          ? 'bg-blue-600 text-white dark:bg-blue-500'
          : 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800/50'
        }
      `}
      title={`This claim appears in ${otherCount} other ${otherCount === 1 ? 'post' : 'posts'}`}
    >
      +{otherCount}
    </span>
  );
}
