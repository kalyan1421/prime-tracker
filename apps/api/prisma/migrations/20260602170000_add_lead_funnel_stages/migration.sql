-- Lead funnel: add Potential + Site Visit stages (client funnel).
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'POTENTIAL';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'SITE_VISIT';
