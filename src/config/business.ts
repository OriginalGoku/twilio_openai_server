export interface BusinessConfig {
  businessName: string;
  businessType: string;
  workingHours: string;
  services: string[];
  assistantName?: string;
}

// This should be used to update information for each buisness
export const businessConfig: BusinessConfig = {
  businessName: "Fitness Accounting",
  businessType: "Accounting and Bookkeeping for Fitness industry",
  workingHours: "Monday to Saturday, 09:00 to 20:00",
  services: ["Accounting", "Book Keeping", "Payroll", "HST/GST Filing"],
  assistantName: "Zeus",
};
