# Prod Plan Code Coverage Report
**Queried:** 2026-07-17 from `typed.unl_fym_policy_latest_load` (read-only)
**Total distinct plan_codes in prod:** 42

---

## Summary

| Category | Codes | Policies |
|---|---|---|
| In lookup table (direct or state-suffix) | 32 | ~38,000+ |
| **Not in lookup table** | **10 base codes** | **~3,555** |
| In lookup table but derivePlanType(code)=Unknown (drift) | 6 base codes | ~144 |

---

## ✅ In Lookup Table

These codes (or their state-suffix variants) are covered by `PLAN_NAME_MAP`:

| plan_code | Base | Policies | derivePlanType result |
|---|---|---|---|
| UTHHC | UTHHC | 16,357 | HHC ✅ |
| UHIP2 | UHIP2 | 8,319 | HIP ✅ |
| UGHIP | UGHIP | 5,203 | HIP ✅ |
| UFHIP | UFHIP | 1,297 | HIP ✅ |
| UNHIP | UNHIP | 1,011 | HIP ✅ |
| UDN24 | UDN24 | 846 | DV ✅ |
| UTHHC OH | UTHHC | 820 | HHC ✅ |
| UFGHI | UFGHI | 753 | HIP ✅ |
| UHIP2 MI | UHIP2 | 545 | HIP ✅ |
| UHIP2 OH | UHIP2 | 453 | HIP ✅ |
| UNHIP IL | UNHIP | 415 | HIP ✅ |
| UNHHC | UNHHC | 357 | HHC ✅ |
| UNHHC KY | UNHHC | 311 | HHC ✅ |
| UNCAN | UNCAN | 263 | Cancer ✅ |
| UAD24 | UAD24 | 130 | — see unmapped below |
| UAHHC OH | UAHHC | 98 | — see unmapped below |
| UDN21 | UDN21 | 76 | DV ✅ |
| UIHHC | UIHHC | 70 | HHC ✅ |
| UDN24 PA | UDN24 | 49 | DV ✅ |
| UCSIA | UCSIA | 17 | **Unknown (drift)** |
| UNFEL TX | UNFEL | 17 | **Unknown (drift)** |
| UAD24 PA | UAD24 | 14 | — see unmapped below |
| UNFEL FL | UNFEL | 13 | **Unknown (drift)** |
| UNFEX | UNFEX | 12 | Life ✅ |
| UDV18 | UDV18 | 10 | **Unknown (drift)** |
| UDN24 OH | UDN24 | 20 | DV ✅ |
| UAD24 OH | UAD24 | 6 | — see unmapped below |
| UNFEL KY | UNFEL | 4 | **Unknown (drift)** |
| UDV17 | UDV17 | 2 | **Unknown (drift)** |
| UNFEL AR | UNFEL | 2 | **Unknown (drift)** |
| UCSIC | UCSIC | 1 | **Unknown (drift)** |
| UCSIB | UCSIB | 1 | **Unknown (drift)** |
| UNFEL WI | UNFEL | 1 | **Unknown (drift)** |
| UNFEX TX | UNFEX | 2 | Life ✅ |
| UNFEX KY | UNFEX | 1 | Life ✅ |
| UNFEL | UNFEL | 94 | **Unknown (drift)** |

---

## ❌ Not in Lookup Table — Action Required

These codes appear in prod but are NOT in `PLAN_NAME_MAP`. Charlie needs to confirm
plan names and whether they should be added to the lookup or treated as Unknown.

| plan_code | Base | Policies | derivePlanType (code) | Notes |
|---|---|---|---|---|
| UAHHC | UAHHC | 2,650 | HHC | **2,650 policies** — largest unmapped group. Likely an HHC variant; "UAHHC" matches HHC pattern so product routing works, but no human-readable name. |
| UAGHI | UAGHI | 486 | HIP | Matches GHI pattern → HIP. No plan name. Likely a GI HIP variant. |
| UAD24 | UAD24 | 150 (130+14+6) | Unknown | **Unknown product type.** "UAD" not in any pattern. Possibly Dental (similar to UDN24) but unconfirmed. |
| UFAGH | UFAGH | 68 | Unknown | Unknown product type. "UFAGH" — possibly FL-with-Assoc GHI variant? |
| UNAHH | UNAHH | 102 (54+48) | Unknown | Unknown product type. "UNAHH" — possibly an HHC variant (AHH?)? Pattern doesn't match HHC/HOME HEALTH. |
| UACC | UACC | 1 | Unknown | Unknown product type. Single policy. |

**Total unmapped policies: ~3,557** — predominantly UAHHC (2,650) and UAGHI (486).

---

## ⚠️ Drift Codes — In Lookup Table but derivePlanType(code) = Unknown

These codes are in `PLAN_NAME_MAP` but the canonical `derivePlanType()` function
returns `Unknown` when passed the raw code string. They resolve correctly when
passed the plan *name* string instead.

This is a bug in `lifecycle-evaluator.ts::derivePlanType()` — it was designed for
plan names (from `form_submissions`), not raw codes (from Max's DB).

**Fix required in `lifecycle-evaluator.ts`** before going live with Max's DB as source.
Do not fix in this mockup — flag for Charlie's review.

| Code | Policies (incl. state variants) | Expected type | Pattern that's missing |
|---|---|---|---|
| UNFEL | 131 (all state variants) | Life | `UNFEL` not in `LIFE\|FINAL EXPENSE\|\bFEX\b\|UNFEX` — it's not the same as UNFEX |
| UCSIA | 17 | Cancer | `UCS` prefix not in `CANCER\|UNCAN\|\bCAN\b` |
| UDV18 | 10 | DV | `UDV` prefix not in `DENTAL\|VISION\|\bDV\b\|UDN\|UDEN` |
| UDV17 | 2 | DV | Same — UDV ≠ UDN |
| UCSIC | 1 | Cancer | Same as UCSIA |
| UCSIB | 1 | Cancer | Same as UCSIA |

**Recommended fix** (one line per branch in `derivePlanType()`):
```
// Cancer: add UCSI[ABC] explicitly or broaden to /CANCER|UNCAN|UCSI|\bCAN\b/
// DV:     add UDV to pattern: /DENTAL|VISION|\bDV\b|UDN|UDV|UDEN/
// Life:   add UNFEL: /LIFE|FINAL EXPENSE|\bFEX\b|UNFEX|UNFEL/
```

Also: `UIHHC` ("Caregiver Shield") resolves correctly by code (HHC substring match)
but the plan *name* "Caregiver Shield" → Unknown. If the name-based path is ever
used for UIHHC, it will misroute. Add "CAREGIVER" to the HHC pattern.

---

## Recommended Actions

1. **Add to PLAN_NAME_MAP** (Charlie to confirm names):
   - `UAHHC` — likely HHC variant (~2,650 policies, already routes HHC via code)
   - `UAGHI` — likely HIP/GI variant (~486 policies, already routes HIP via code)
   - `UAD24` — need Charlie to confirm; may be Dental (~150 policies, routes Unknown)
   - `UFAGH` — confirm product type (~68 policies, routes Unknown)
   - `UNAHH` — confirm product type (~102 policies, routes Unknown)
   - `UACC` — confirm product type (1 policy)

2. **Fix `derivePlanType()` in `lifecycle-evaluator.ts`** to handle raw codes:
   - Add `UNFEL` to Life pattern (131 affected policies)
   - Add `UDV` to DV pattern (12 affected policies)
   - Add `UCSI` to Cancer pattern (19 affected policies)
   - Add `CAREGIVER` to HHC pattern (70 UIHHC policies — code path works, name path doesn't)

3. **Immediate risk**: UAHHC (2,650 policies) and UAGHI (486 policies) have no
   plan name in the lookup but DO route correctly by product type via `derivePlanType()`.
   They will push to GHL with `planName: null` — GHL receives an empty plan name field.
   Confirm whether this is acceptable or whether names need to be added first.
