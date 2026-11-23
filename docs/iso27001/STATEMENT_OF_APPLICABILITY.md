# Statement of Applicability (Draft)

มาตรฐาน: ISO/IEC 27001:2022 Annex A

สถานะ: `I` implemented in repository, `P` partial, `O` organization evidence/action required, `N` not applicable with justification

ฉบับนี้เป็น draft ทางเทคนิค ต้องเชื่อม risk ID, ใส่ owner และลงนามโดยผู้บริหารก่อนใช้เป็น SoA อย่างเป็นทางการ

## A.5 Organizational controls

| Control | ใช้ | สถานะ | หลักฐาน/การดำเนินการ |
|---|:---:|:---:|---|
| 5.1 Security policy | Y | P | `SECURITY.md`, `docs/SECURITY_PDPA.md`; ต้องอนุมัติ/สื่อสาร |
| 5.2 Roles/responsibilities | Y | P | role matrix ใน SECURITY_PDPA; แต่งตั้ง ISMS/DPO/system owners |
| 5.3 Segregation of duties | Y | P | role guards; เพิ่ม dual approval/release separation |
| 5.4 Management responsibilities | Y | O | ต้องมีคำสั่ง/management review |
| 5.5 Contact with authorities | Y | O | ระบุ PDPC/CERT/ตำรวจ/ผู้ให้บริการและเกณฑ์ติดต่อ |
| 5.6 Security communities | Y | O | สมัคร threat/advisory sources และเก็บ review |
| 5.7 Threat intelligence | Y | O | เพิ่ม monthly threat review และ action log |
| 5.8 Security in projects | Y | P | risk/change procedure; บังคับ security acceptance criteria |
| 5.9 Asset inventory | Y | P | README + risk register; เพิ่ม owner/classification/lifecycle |
| 5.10 Acceptable use | Y | O | จัดทำและให้ผู้ใช้รับทราบ |
| 5.11 Return of assets | Y | O | HR/offboarding/device checklist |
| 5.12 Information classification | Y | P | PII categories ใน SECURITY_PDPA; อนุมัติ scheme |
| 5.13 Information labelling | Y | O | กำหนด label สำหรับ export/backup/evidence |
| 5.14 Information transfer | Y | P | TLS/limited channels; เพิ่ม transfer procedure/DPA |
| 5.15 Access control | Y | I | RLS/RPC/role matrix/anon 401 test |
| 5.16 Identity lifecycle | Y | P | admin user RPC; เพิ่ม joiner-mover-leaver evidence |
| 5.17 Authentication information | Y | P | bcrypt/policy/secret rules; MFA ยังไม่มี |
| 5.18 Access rights review | Y | P | procedure มี quarterly review; ต้องมี records |
| 5.19 Supplier security | Y | O | supplier register/DPA ยังต้องจัดทำ/อนุมัติ |
| 5.20 Supplier agreements | Y | O | ระบุ security/privacy/breach/deletion clauses |
| 5.21 ICT supply chain | Y | P | pinned CDN/SRI; เพิ่ม supplier assurance/SBOM |
| 5.22 Supplier monitoring/change | Y | O | annual/triggered review records |
| 5.23 Cloud service governance | Y | P | Supabase controls; เพิ่ม exit plan/region/shared responsibility |
| 5.24 Incident preparation | Y | P | operating procedure; ต้องแต่งตั้งทีมและซ้อม |
| 5.25 Event assessment | Y | P | severity/SLA defined; ต้องใช้จริง |
| 5.26 Incident response | Y | P | response steps defined; tabletop evidence missing |
| 5.27 Lessons learned | Y | O | post-incident template/records |
| 5.28 Evidence collection | Y | P | immutable audit; เพิ่ม chain-of-custody procedure |
| 5.29 Security during disruption | Y | P | offline/manual concept; BCP test missing |
| 5.30 ICT continuity readiness | Y | P | backup/offline; RTO/RPO/restore proof missing |
| 5.31 Legal/regulatory obligations | Y | P | PDPA mapping; legal register/annual review missing |
| 5.32 Intellectual property | Y | O | ระบุ license/ownership/CDN licenses |
| 5.33 Protection of records | Y | P | audit immutability/retention; approved schedule/evidence store missing |
| 5.34 Privacy/PII | Y | P | encryption/masking/ROPA/privacy requests; DPIA/DPA actions open |
| 5.35 Independent review | Y | O | ต้องมี independent internal audit/penetration test |
| 5.36 Compliance with rules | Y | P | automated gate/verify SQL; operational sampling missing |
| 5.37 Operating procedures | Y | P | `OPERATING_PROCEDURES.md`; owner/approval/evidence missing |

## A.6 People controls

| Control | ใช้ | สถานะ | หลักฐาน/การดำเนินการ |
|---|:---:|:---:|---|
| 6.1 Screening | Y | O | หน่วยงานกำหนดตามกฎหมาย/ความเสี่ยงของ role |
| 6.2 Employment terms | Y | O | เพิ่ม confidentiality/security duties |
| 6.3 Awareness/training | Y | O | อบรมก่อนใช้และอย่างน้อยปีละครั้ง; phishing exercise |
| 6.4 Disciplinary process | Y | O | HR policy และ approved process |
| 6.5 Responsibilities after change/exit | Y | O | offboarding, revoke, asset return, NDA survival |
| 6.6 Confidentiality agreements | Y | O | NDA/contractor clauses และ review |
| 6.7 Remote work | Y | O | managed device, network, privacy, lost-device policy |
| 6.8 Security event reporting | Y | P | `SECURITY.md`; สื่อสารช่องทางและทดสอบ |

## A.7 Physical controls

| Control | ใช้ | สถานะ | หลักฐาน/การดำเนินการ |
|---|:---:|:---:|---|
| 7.1 Physical perimeter | Y | O | สำนักงาน/ที่เก็บเอกสารต้องประเมินและกำหนดเขต |
| 7.2 Physical entry | Y | O | visitor/access records |
| 7.3 Secure offices/rooms | Y | O | lock/key ownership and review |
| 7.4 Physical monitoring | Y | O | ประเมิน CCTV/alert ตามความเสี่ยงและ privacy |
| 7.5 Environmental threats | Y | O | น้ำท่วม ไฟ ไฟฟ้า ความร้อน และ climate review |
| 7.6 Working in secure areas | Y | O | procedure สำหรับห้อง/แฟ้ม/อุปกรณ์สำคัญ |
| 7.7 Clear desk/screen | Y | P | privacy mode + idle lock; ต้องมี workplace policy |
| 7.8 Equipment placement/protection | Y | O | endpoint/site survey |
| 7.9 Off-premises assets | Y | P | field-device rules; inventory/remote wipe proof missing |
| 7.10 Storage media | Y | O | removable media restriction/encryption/disposal |
| 7.11 Supporting utilities | Y | O | UPS/connectivity/manual fallback assessment |
| 7.12 Cabling | Y | O | site assessment; cloud-only portions N/A with evidence |
| 7.13 Equipment maintenance | Y | O | maintenance/patch/authorized repair records |
| 7.14 Secure disposal/reuse | Y | O | wipe verification and disposal certificate |

## A.8 Technological controls

| Control | ใช้ | สถานะ | หลักฐาน/การดำเนินการ |
|---|:---:|:---:|---|
| 8.1 User endpoints | Y | P | TTL/idle lock; managed-device baseline/MDM missing |
| 8.2 Privileged access | Y | P | super_admin separation/audit; MFA/review missing |
| 8.3 Information access restriction | Y | I | RLS, private schema, role guards, anon 401 test |
| 8.4 Source code access | Y | P | Git; branch protection/access review evidence missing |
| 8.5 Secure authentication | Y | P | bcrypt/lockout/revocation; MFA open |
| 8.6 Capacity management | Y | O | Supabase/storage quotas, trend and thresholds |
| 8.7 Malware protection | Y | O | endpoint/browser control and response evidence |
| 8.8 Technical vulnerability management | Y | P | CI gate; add SAST/DAST/dependency scan/remediation SLA |
| 8.9 Configuration management | Y | P | config example/migrations/verify SQL; baseline/drift record missing |
| 8.10 Information deletion | Y | P | retention/anonymise; storage lifecycle deletion open |
| 8.11 Data masking | Y | I | national ID last4/phone masking/privacy mode |
| 8.12 Data leakage prevention | Y | P | export restriction/audit; endpoint/DLP controls missing |
| 8.13 Backup | Y | P | encrypted export; PITR/restore drill evidence missing |
| 8.14 Processing redundancy | Y | O | supplier/architecture assessment and manual fallback test |
| 8.15 Logging | Y | I | server audit, immutable hash chain |
| 8.16 Monitoring activities | Y | P | logs exist; alerting/review SLA/SIEM missing |
| 8.17 Clock synchronization | Y | I | server timestamps; verify provider time source |
| 8.18 Privileged utility programs | Y | O | SQL Editor/admin console access inventory/review |
| 8.19 Software installation | Y | O | managed endpoint/browser/PWA installation policy |
| 8.20 Network security | Y | P | TLS/cloud controls; network/hosting evidence missing |
| 8.21 Network service security | Y | P | Supabase/CDN definitions; SLA/security requirements missing |
| 8.22 Network segregation | Y | O | prod/non-prod/admin access design evidence |
| 8.23 Web filtering | Y | O | endpoint/DNS policy decision and evidence |
| 8.24 Cryptography | Y | I | TLS, bcrypt, pgcrypto, Vault; key lifecycle drill open |
| 8.25 Secure development lifecycle | Y | P | CI/change procedure; formal gates/training missing |
| 8.26 Application security requirements | Y | P | existing controls/risk register; requirement traceability missing |
| 8.27 Secure architecture principles | Y | P | private schema/RLS/server authority; architecture review record missing |
| 8.28 Secure coding | Y | P | escaping/SRI/check script; inline handlers/XSS tests open |
| 8.29 Security testing | Y | P | automated structural checks; SAST/DAST/pentest/acceptance tests open |
| 8.30 Outsourced development | Y | O | ถ้ามี contractor ต้องเพิ่ม due diligence/contract/review; ปัจจุบันต้องยืนยัน |
| 8.31 Dev/test/prod separation | Y | O | environment inventory and access separation missing |
| 8.32 Change management | Y | P | Git/CI/procedure; approval/rollback evidence missing |
| 8.33 Test information | Y | O | ห้ามใช้ production PII; masking/synthetic-data procedure |
| 8.34 Protection during audit tests | Y | O | rules of engagement, backups, maintenance window, data handling |

## Approval

| Role | Name | Decision | Date | Signature/reference |
|---|---|---|---|---|
| ISMS owner | TBD | Approve/Reject | TBD | TBD |
| Business owner | TBD | Approve/Reject | TBD | TBD |
| DPO/privacy owner | TBD | Approve/Reject | TBD | TBD |

Control ที่เป็น `P` หรือ `O` ต้องเชื่อมกับ risk/treatment, owner และ due date ก่อนยื่น Stage 1 audit
