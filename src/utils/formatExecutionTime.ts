// Derived from cubiq/Mellon-client and modified by the MoDiff project.

/**
 * Formats execution time in seconds to a human-readable string
 * @param timeInSeconds - Execution time in seconds
 * @returns Formatted time string
 */
export function formatExecutionTime(timeInSeconds: number): string {
  if (timeInSeconds === 0 || timeInSeconds < 0.001) {
    return '~0';
  }

  if (timeInSeconds < 1) {
    // Convert to milliseconds for times less than 1 second
    const milliseconds = timeInSeconds * 1000;
    return `${milliseconds.toFixed(0)}ms`;
  }

  if (timeInSeconds < 60) {
    // Show in seconds for times less than 1 minute
    return `${timeInSeconds.toFixed(3)}s`;
  }

  if (timeInSeconds < 3600) {
    // Show in minutes and seconds for times less than 1 hour
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.floor(timeInSeconds % 60);
    return `${minutes}m ${seconds}s`;
  }

  // Show in hours and minutes for times 1 hour or more
  const hours = Math.floor(timeInSeconds / 3600);
  const minutes = Math.floor((timeInSeconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

export function splitRoundedSeconds(seconds: number) {
  const roundedSeconds = Math.round(seconds);
  return { minutes: Math.floor(roundedSeconds / 60), seconds: roundedSeconds % 60 };
}

export function formatRunDuration(milliseconds: number | undefined): string {
  if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds)) return '-';
  if (milliseconds < 1000) return `${Math.max(0, Math.round(milliseconds))}ms`;
  const seconds = milliseconds / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const rounded = splitRoundedSeconds(seconds);
  return `${rounded.minutes}:${String(rounded.seconds).padStart(2, '0')}`;
}
