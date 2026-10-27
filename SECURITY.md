# Security

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/berkebasbay/loopset/security/advisories/new). Include a minimal synthetic reproduction, affected version, expected behavior and impact. Keep credentials, personal data and customer models out of public issues.

Loopset processes models locally. It has no account service, model-upload endpoint or application analytics. Imports must remain bounded and validated; exported reports must neutralize HTML/CSV injection and preserve the recorded run's identity.

Use isolated test contexts and synthetic files when reproducing a problem. Preserve browser libraries and downloaded backups.
