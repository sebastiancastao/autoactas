-- Add identificacion and tarjeta_profesional to usuarios table
-- These fields are needed for the conciliador signature block in legal documents

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS identificacion VARCHAR(50);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS tarjeta_profesional VARCHAR(100);
