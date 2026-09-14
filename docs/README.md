# docs/

Supporting material. The primary documentation lives at the repository root:

| Document | Contents |
|---|---|
| [../README.md](../README.md) | Overview, setup, demo accounts |
| [../ARCHITECTURE.md](../ARCHITECTURE.md) | System design and the reasoning behind it |
| [../DATABASE.md](../DATABASE.md) | Schema, constraints, indexes, RLS |
| [../API.md](../API.md) | Every endpoint |
| [../SECURITY.md](../SECURITY.md) | Threat model and controls |
| [../TESTING.md](../TESTING.md) | What is tested |
| [../DEPLOYMENT.md](../DEPLOYMENT.md) | Running it for real |
| [../PRODUCT_SPEC.md](../PRODUCT_SPEC.md) | The product as built, against the specification |
| [../PROJECT_STATE.md](../PROJECT_STATE.md) | Current state and limitations |

## Diagrams

The request lifecycle, the system diagram and the entity map are rendered as text in
ARCHITECTURE.md and DATABASE.md so they stay accurate — a diagram that lives in a binary file
drifts from the code within a week.

## Demo assets

[`demo/sample-upi-qr.png`](demo/sample-upi-qr.png) is a UPI QR code for the seeded demo account
Aman Singh (`aman.ug22.cs@demoupi` — a fictional handle that no bank will accept). Upload it from
**Profile → Payment details** to demonstrate the payment QR flow without using a real account.

## Screenshots

Add screenshots here for a report or presentation. `npm run dev` with the seeded data gives a
campus with requests at every stage, an open report and an open dispute ready to capture.
