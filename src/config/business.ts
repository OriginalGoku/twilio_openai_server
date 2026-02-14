export interface BusinessConfig {
  businessName: string;
  businessType: string;
  workingHours: string;
  services: string[];
  assistantName?: string;
}

// Update this file with your actual business details.
export const businessConfig: BusinessConfig = {
  businessName: "Fitness Accounting",
  businessType: "Accounting and Bookkeeping for Fitness industry",
  workingHours: "Monday to Saturday, 09:00 to 20:00",
  services: ["Accounting", "Book Keeping", "Payroll", "HST/GST Filing"],
  assistantName: "Zeus",
};
