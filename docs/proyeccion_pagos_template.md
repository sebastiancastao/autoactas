# Proyeccion De Pagos Template

## Files
- Source analyzed: `PROYECCION DE PAGOS ADALID GONZALEZ LEON.xlsx`
- Extracted template: `PROYECCION_DE_PAGOS_TEMPLATE.xlsx`

## Workbook structure
- Sheets (14):
  - `BANCO POPULAR`
  - `BANCO`
  - `TUYA`
  - `FUNDACION MUNDO MUJER`
  - `CEMCOP`
  - `ADELANTE`
  - `YANBAL DE`
  - `REFINANCIA ADM`
  - `PRA GROUP`
  - `CLARO TEC MOV`
  - `COLOMBIAMOVIL`
  - `COOPERATIVA`
  - `SUMMA OPE S.A.S.`
  - `MOVISTAR`

## Input cells per sheet (template)
- `M5`: borrower full name (`<NOMBRE COMPLETO>`)
- `M7`: borrower identification (`<NUMERO_IDENTIFICACION>`)
- `I5`: credit amount (numeric)
- `I6`: monthly rate (decimal, default `0.005`)
- `I7`: term in months (numeric, default `120`)
- `I8`: day of first payment (numeric)
- `J8`: month of first payment (numeric)
- `K8`: year of first payment (numeric)

## Main computed area
- Header row: `17`
- Amortization rows usually start at: `19`
- Main computed columns:
  - `I`: saldo capital
  - `L`: abono adicional a capital
  - `N`: abono capital
  - `P`: intereses
  - `Q`: total cuota

## Notes found during analysis
- The file has formula offsets that differ by sheet:
  - Most sheets summarize totals in row `139`.
  - `BANCO` summarizes totals in row `129`.
  - `CEMCOP` and `ADELANTE` summarize totals in row `249`.
- This was preserved as-is in the extracted template.
