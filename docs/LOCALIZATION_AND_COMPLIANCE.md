# Localization & Compliance Readiness

## Design
Puravigal POS uses country adapters controlling currency, precision, locale, identifiers, tax profiles, invoice fields, document numbering, reporting, e-invoicing and language/RTL behavior.

## India
The invoice model supports supplier/recipient GSTIN, HSN/SAC, place of supply, CGST/SGST/IGST/UTGST/cess components, reverse-charge flag, tax-inclusive/exclusive pricing, credit/debit notes and export flags. Official CBIC invoice rules must be used as the release reference.

## UAE
Default VAT configuration supports the UAE 5% standard VAT rate, while tax profiles also support zero-rated and exempt supplies. UAE eInvoicing is a separate structured electronic exchange/reporting capability; PDF/email/printed invoices are not themselves eInvoices.

The UAE Ministry of Finance says the programme uses a Peppol-based model. Official guidance states the pilot began 1 July 2026; mandatory implementation for persons with annual revenue at or above AED 50m is due 1 January 2027, while persons below AED 50m are due 1 July 2027. The MoF announced an extension of the ASP appointment deadline for the >AED 50m group to 30 October 2026. Revalidate all dates before production release.

Sources: official UAE MoF eInvoicing portal, UAE MoF announcements, UAE FTA VAT FAQ, and official CBIC GST invoice rules.

## Release rule
Never claim tax or e-invoice compliance merely because fields exist. Compliance requires correct country/version rules plus provider/authority testing where applicable.
