/**
 * Utility functions for Jira tools
 */

/**
 * Parse and sanitize labels to ensure proper format
 * Handles various input formats and ensures labels don't contain brackets or quotes
 * 
 * @param labels - Labels in various formats (array, string, etc.)
 * @returns Cleaned array of label strings
 */
export function parseLabels(labels: string[] | string): string[] {
  let result: string[] = [];
  
  if (Array.isArray(labels)) {
    // Handle array input
    result = labels.map(label => {
      // If the label itself looks like a stringified array or has quotes, clean it
      if (typeof label === 'string') {
        // Remove surrounding quotes, brackets, etc.
        return label.replace(/^[\['"`]|[\]'"`]$/g, '').trim();
      }
      return String(label);
    });
  } else if (typeof labels === 'string') {
    // If the entire input is a string that looks like an array (e.g., "['test']")
    if (labels.trim().startsWith('[') && labels.trim().endsWith(']')) {
      try {
        // Try to parse it as JSON
        const parsed = JSON.parse(labels.replace(/'/g, '"'));
        if (Array.isArray(parsed)) {
          result = parsed.map(item => String(item).trim());
        } else {
          // If parsing succeeded but result isn't an array
          result = [String(parsed).trim()];
        }
      } catch (e) {
        // If parsing failed, treat the whole string as a single label
        // But remove the brackets and quotes
        result = [labels.replace(/^\[|\]$/g, '').replace(/['"]/g, '').trim()];
      }
    } else {
      // Handle comma-separated string
      result = labels.split(',').map(s => s.trim());
    }
  }
  
  // Final cleanup - remove any empty strings
  return result.filter(label => label.length > 0);
}
