/**
 * HRIS Design System - Consistent Styling Guidelines
 * 
 * Usage: Import these constants and use in all HRIS components
 */

// Button Sizes (Consistent across all pages)
export const BUTTON_SIZES = {
  sm: "h-8 px-3 text-xs",      // Small - for table actions
  md: "h-9 px-4 text-sm",      // Medium - default for most buttons
  lg: "h-10 px-5 text-base",   // Large - primary actions only
  icon: "h-8 w-8 p-0",         // Icon buttons - square
  iconSm: "h-7 w-7 p-0",       // Small icon buttons
};

// Button Variants
export const BUTTON_VARIANTS = {
  primary: "bg-green-600 hover:bg-green-700 text-white",
  secondary: "bg-gray-100 hover:bg-gray-200 text-gray-900",
  outline: "border border-gray-300 hover:bg-gray-50 text-gray-700",
  ghost: "hover:bg-gray-100 text-gray-600",
  destructive: "bg-red-600 hover:bg-red-700 text-white",
  link: "text-green-600 hover:underline",
};

// Card Styles
export const CARD_STYLES = {
  base: "bg-white border border-gray-200 rounded-lg shadow-sm",
  header: "px-4 py-3 border-b border-gray-200",
  content: "p-4",
  footer: "px-4 py-3 border-t border-gray-200 bg-gray-50",
};

// Table Styles
export const TABLE_STYLES = {
  root: "w-full caption-bottom text-sm",
  header: "bg-gray-50 border-b border-gray-200",
  row: "border-b border-gray-100 hover:bg-gray-50 transition-colors",
  cell: "px-3 py-2.5 align-middle text-sm",
  headCell: "px-3 py-3 font-semibold text-gray-700",
};

// Form Input Sizes
export const INPUT_SIZES = {
  sm: "h-8 text-xs",
  md: "h-9 text-sm",
  lg: "h-10 text-base",
};

// Badge Styles
export const BADGE_STYLES = {
  sm: "h-5 px-2 text-[10px] font-medium",
  md: "h-6 px-2.5 text-xs font-medium",
};

// Status Colors (Consistent across all modules)
export const STATUS_COLORS = {
  success: "bg-green-100 text-green-800 border-green-300",
  warning: "bg-yellow-100 text-yellow-800 border-yellow-300",
  danger: "bg-red-100 text-red-800 border-red-300",
  info: "bg-blue-100 text-blue-800 border-blue-300",
  neutral: "bg-gray-100 text-gray-800 border-gray-300",
  purple: "bg-purple-100 text-purple-800 border-purple-300",
};

// Spacing (Consistent gaps and padding)
export const SPACING = {
  page: "p-4 sm:p-6",              // Page container padding
  section: "space-y-4",            // Section spacing
  card: "space-y-3",               // Card content spacing
  buttonGroup: "flex gap-2",       // Button group gap
  formField: "space-y-1.5",        // Form field spacing
  tableAction: "flex gap-1",       // Table action buttons gap
};

// Typography
export const TYPOGRAPHY = {
  pageTitle: "text-xl sm:text-2xl font-bold text-gray-900",
  pageSubtitle: "text-sm text-gray-500 mt-1",
  cardTitle: "text-base font-semibold text-gray-900",
  sectionTitle: "text-sm font-semibold text-gray-700",
  label: "text-xs font-medium text-gray-700",
  body: "text-sm text-gray-600",
  caption: "text-xs text-gray-500",
};

// Responsive Breakpoints
export const BREAKPOINTS = {
  mobile: "sm:",    // ≥640px
  tablet: "md:",    // ≥768px
  desktop: "lg:",   // ≥1024px
};

// Common Component Patterns
export const PATTERNS = {
  // Page Header Pattern
  pageHeader: `flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6`,
  
  // Action Bar Pattern (buttons on right)
  actionBar: `flex items-center gap-2`,
  
  // Filter Bar Pattern
  filterBar: `flex flex-col sm:flex-row gap-3 mb-4`,
  
  // Table Actions Pattern
  tableActions: `flex items-center gap-1`,
  
  // Mobile-Friendly Card
  mobileCard: `block sm:hidden`,
  
  // Desktop-Only Table
  desktopTable: `hidden sm:block`,
};

// Helper function to merge classes
export function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(' ');
}

// Pre-built button component props
export const createButtonProps = (
  variant: keyof typeof BUTTON_VARIANTS = 'secondary',
  size: keyof typeof BUTTON_SIZES = 'md'
) => ({
  className: cn(BUTTON_SIZES[size], BUTTON_VARIANTS[variant]),
});

// Pre-built badge props for status
export const getStatusBadgeProps = (status: string) => {
  const statusMap: Record<string, string> = {
    // Attendance
    present: STATUS_COLORS.success,
    late: STATUS_COLORS.warning,
    absent: STATUS_COLORS.danger,
    'half-day': STATUS_COLORS.info,
    remote: STATUS_COLORS.purple,
    
    // Leave
    pending: STATUS_COLORS.warning,
    approved: STATUS_COLORS.success,
    rejected: STATUS_COLORS.danger,
    cancelled: STATUS_COLORS.neutral,
    
    // Candidate
    applied: STATUS_COLORS.info,
    screening: STATUS_COLORS.warning,
    psikotes: STATUS_COLORS.purple,
    interview: STATUS_COLORS.purple,
    offer: STATUS_COLORS.warning,
    talent_pool: STATUS_COLORS.info,
    hired: STATUS_COLORS.success,
    rejected: STATUS_COLORS.danger,
    archived: STATUS_COLORS.neutral,
    
    // Employee Status
    probation: STATUS_COLORS.warning,
    contract: STATUS_COLORS.info,
    permanent: STATUS_COLORS.success,
    internship: STATUS_COLORS.purple,
    resigned: STATUS_COLORS.neutral,
    terminated: STATUS_COLORS.danger,
  };
  
  return {
    className: cn(BADGE_STYLES.sm, statusMap[status] || STATUS_COLORS.neutral),
  };
};
