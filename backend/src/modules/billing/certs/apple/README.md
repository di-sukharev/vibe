# Apple root certificates

The App Store verifier trusts every `.cer`, `.crt`, `.der`, and `.pem` file in this directory, so keep only reviewed Apple roots here. The backend image includes them; verification needs no download and no machine-specific path. `APPLE_IAP_ROOT_CERTS_DIR` replaces the directory ([IAP](../../../../../../docs/IAP.md)).

Source: [Apple PKI](https://www.apple.com/certificateauthority/). The files are PEM conversions of Apple's DER downloads, with unchanged certificate contents.

| File | SHA-256 fingerprint | Valid until |
| --- | --- | --- |
| `AppleIncRootCertificate.crt` | `B0:B1:73:0E:CB:C7:FF:45:05:14:2C:49:F1:29:5E:6E:DA:6B:CA:ED:7E:2C:68:C5:BE:91:B5:A1:10:01:F0:24` | 2035-02-09 |
| `AppleRootCA-G2.crt` | `C2:B9:B0:42:DD:57:83:0E:7D:11:7D:AC:55:AC:8A:E1:94:07:D3:8E:41:D8:8F:32:15:BC:3A:89:04:44:A0:50` | 2039-04-30 |
| `AppleRootCA-G3.crt` | `63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79` | 2039-04-30 |

To replace or add a certificate:

1. Download it from Apple over HTTPS.
2. Inspect its subject, issuer, validity, and SHA-256 fingerprint: `openssl x509 -in <file> -noout -subject -issuer -enddate -fingerprint -sha256`. Add `-inform der` for a DER file.
3. Update this table in the same change.
