# Data Dictionary — September 2026 reference dataset

Discovered by inspecting the actual September 2026 exports (exported 02-Oct-2026).
All CRM files are Microsoft Dynamics-style exports: `(Do Not Modify)` GUID id + `Row Checksum` + `Modified On` (Excel serial), plus business columns and a `hiddenSheet` with allowed option-set values.

Month identification: CRM files are **point-in-time snapshots** (Created On spans 2024 → 02-Oct-2026). The reporting month comes from **HCP event timestamps** (03-Sep-2026 → 02-Oct-2026, majority September 2026) plus user confirmation.

## 1. ACTIVE_UNITS — `Active Units … .xlsx` → sheet `Active Units` (25,395 rows)

| Column | Notes |
|---|---|
| `(Do Not Modify) Unit` | GUID PK, unique, no dups |
| Name | Unit number (e.g. `ALX-1952-D`, `BAD-1204`-style). **Not unique**: values repeat (×3) across different GUIDs; `old phases fake unit` ×4 |
| Compound | 46 distinct + 71 blanks. Top: Badya 12,136; PHNC 4,327; Palm Parks 1,582 |
| Related Unit | Usually = Name; 4 blanks |
| Gate Access Suspension | 1 non-blank (`Both`) |
| Rent Suspension | `No` or blank |
| Pending Maintenance Fees (Related Unit) | `No` (6,092), `Yes` (2), else blank |
| Created On | Excel serial |

hiddenSheet option sets: access scope `Gate/Beach/Both`, Yes/No flags.

## 2. ALL_USERS — `All Users … .xlsx` → sheet `All Users` (19,136 rows)

| Column | Notes |
|---|---|
| `(Do Not Modify) User` | GUID PK, unique |
| Name | 439 blanks; generic values (`mohamed` ×107, `ahmed` ×105); Arabic + Latin |
| Mobile Number | 439 blanks; **placeholders**: `+20`, `+201`, `0`, `0000` (norm → NULL) |
| Email | 459 blanks; duplicates exist (`rania.perla@gmail.com` ×11) |
| National ID | 2,223 blanks; placeholders (`00000`) |
| Marital Status | `Married` 705 / `Single` 162 / blank 18,269 |
| User Status | `Active` 15,048 · `Deactivated` 1,922 · `Under Review` 1,335 · `Rejected` 831 (dynamic — never hardcoded) |
| Registered As | `Family Member` 11,551 · `Owner` 6,389 · `Tenant` 796 · `Helper` 336 · `REF Owner` 41 · `Tenant Family Member` 16 · `REF` 2 (+5 blank) |
| Created On | Excel serial |

## 3. UNIT_ACCESS — `All Units Access … .xlsx` → sheet `All Units Access` (25,445 rows)

User↔unit relationships. `User` and `Unit` are **names**, not IDs (matched by normalized name / unit number + compound). 158 blank users, 10 blank units, 80 blank compounds. `Access Type`: Family Member 14,269 · Owner 9,768 · Helpers 477 · REF 417 · Tenant 399 · REF Owner 59 · Tenant Family Member 20. `Status`: Active 21,987 / Inactive 3,458. `Invitation Provider` blank in 9,927 rows. 45 compounds (mix differs from Active Units: Hacienda Bay 13,264 on top).

## 4. VEHICLES — `All Vehicles … .xlsx` → sheet `All Vehicles` (2,059 rows)

| Column | Notes |
|---|---|
| `(Do Not Modify) Vehicle` | GUID PK |
| Make / Model / Year | Free text, inconsistent case (`C180` vs `c180`); years 2015–2026 + outliers |
| Palette Code | **Arabic plate**, e.g. `س أ ص٨٨٧٩`. Normalized to `plate_norm` + `plate_norm_latin`; original preserved |
| Related User | Name (matched to users by normalized name; stub-created if unknown) |
| Status Reason | `Approved By PHD` 1,357 · `Under Review` 319 · `Deactivated` 230 · `Rejected` 153 |

## 5. INVITATION_REQUESTS — `All Invitation Requests … .xlsx` → sheet `All Invitation Requests` (23,681 rows)

No compound column (attributed via provider/member → user → compound). `Code` blank in 3,815; `12345678` ×156 (placeholder). `Invitation To` blank in 17,498. `Type`: New User 20,267 / Existing User 2,363. `Status Reason`: Completed 12,357 · Confirmed 5,715 · Deactivated 4,176 · Requested 564 · Rejected By Owner 422 · Rejected By Community Team 376 · Under Review 67 · Rejected By User 4. No invented `Generated/Used` statuses.

## 6. ACTIVE_GATE_PASSES — `Active Gate Passes … .xlsx` → sheet `Active Gate Passes` (**100,000 rows = export limit ⚠**)

`Compound Ref` (13 values; Hacienda Bay 68,267; Hacienda White 24,080; 62 blank), `Unit Ref.` (504 blank), `User Ref.` = name (504 blank), `Access Type`: Guest 78,425 · Beach 21,071 · Commercial 442. `Entry Date` / `Valid Until` Excel serials. Entry dates span 2025 → Oct-2026 (cumulative passes, not September-only).

## 7. HCP_VEHICLE_ACCESS — `Entrance and Exit Retrieval_… .xlsx` → sheet `Entrance and Exit Retrieval` (**100,000 rows = export limit ⚠**)

| Column | Notes |
|---|---|
| License Plate No. | 22,125 distinct; `Unknown` ×21,958; Arabic plates |
| Parking Lot | Main Gate 74,058 · D1V1A · D1V2A · D1V1B → mapped to compounds via `parking_lot_compound` setting (default Badya) |
| Enter or Exit | Exit 53,297 / Entering 46,703 |
| Entering/Departure Time | `YYYY/MM/DD HH:mm:ss` strings, 03-Sep-2026 → 02-Oct-2026 |
| Entrance/Exit (gate) | G3_1 · G2 · V1A_CH · G1 · V1B_CH · G3_2 |
| Entry and Exit Method | `Barrier Not Open` 98,905 / `Auto Entry & Exit` 1,095 |
| Entry and Exit Result | `Not Passed` 98,905 / `Pass` 1,095 |
| Reason | `Vehicle Not in List: Need to Open Barrier` 98,705 · `Vehicle in List: Auto-Open Barrier` 1,095 · +3 rare |
| Vehicle List | Temporary Vehicle 98,707 · Badya 953 · Vehicle in List 187 · Gates Tester 153 |
| Vehicle Owner | Only 1,098 non-blank (73 distinct; auto-matched to CRM where exactly one name hit) |
| Country/Region, Vehicle Type, Color, Brand | As observed; `Card No.` and thumbnails entirely blank |

Second sheet `Sheet1` = plate frequency pivot (ignored on ingest; primary sheet used).

**No unit link exists in HCP events** — unit attribution for vehicle activity is not possible from this file (documented, not worked around).

## 8. HANDOVER — `Handing over, finishing permits and resident_9377.xlsx` (1,846 rows)

Alexandria scope. `Unit Code` (ALX-*), `Category`, `Zone`, `Handing over` (Excel serial or blank), `Finishing permit` (`DONE` ×384), `resident` (`DONE` ×50), `Planned Delivery Date` (serial). Header row auto-detected (first data sheet, not `hiddenSheet`).

## 9. Auxiliary (NOT ingested as source)

- `All_Users_Merged_Unit_Registered_As.xlsx` — a previous manual merge (join fan-out 25,445 rows; `Match Method`: Name + Registered As / Name only / Access Type fallback). Kept as reference for match-method expectations only.
- `Person Information_2026_10_02… .xlsx` — an **empty HCP import template**, not data.
- `Property Listing…`, `Active Property listings…`, `Rental Listings…`, `Resale Inventory…` — sales/listing domain, out of scope.
- `palm hills app dashboard.xlsx` (prior manual dashboard attempt) and `Community App Features Guide.xlsx` (app user guide) — business context only.

## Absent but expected (flagged, never fabricated)

`HCP_PERSON_AUTH`, `HCP_VISITOR_AUTH`, `HCP_PERSON_INFORMATION` — face-recognition and HCP-visitor analytics stay unavailable until these exports are provided.
