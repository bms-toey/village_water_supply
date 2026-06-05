-- ══════════════════════════════════════════════════════════════
-- Seed Demo Data — รันใน Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════

-- ─── 1. Villages ─────────────────────────────────────────────
INSERT INTO villages (name, moo_number, gps_lat, gps_lng) VALUES
  ('หมู่ 1 บ้านป่า',  1, 18.7883, 98.9853),
  ('หมู่ 2 บ้านคลอง', 2, 18.7860, 98.9840),
  ('หมู่ 3 หนองใหญ่', 3, 18.7900, 98.9870),
  ('หมู่ 3 ท่าช้าง',  3, 18.7920, 98.9890),
  ('หมู่ 4 โคกสูง',   4, 18.7940, 98.9850)
ON CONFLICT (name) DO NOTHING;

-- ─── 2. Rate Tiers ───────────────────────────────────────────
INSERT INTO rate_tiers (from_unit, to_unit, rate_per_unit, svc_charge_small, svc_charge_large, late_fee_per_month)
VALUES
  ( 0,   10,  5.00, 20, 30, 50),
  (11,   30,  8.50, 20, 30, 50),
  (31,   60, 12.00, 20, 30, 50),
  (61, NULL, 15.00, 20, 30, 50)
ON CONFLICT DO NOTHING;

-- ─── 3. Members (explicit IDs) ───────────────────────────────
INSERT INTO members (
  id, first_name, last_name, national_id, house_no,
  village_id, member_type, household_count, registration_date,
  phone, line_id, email, gps_lat, gps_lng,
  meter_no, meter_size, meter_brand, meter_install_date, meter_expire_date,
  last_read, last_read_date, status
) VALUES
  (100245,'สมชาย','รักน้ำใจ','1-2345-67890-12-3','42/1',
    (SELECT id FROM villages WHERE name='หมู่ 1 บ้านป่า'),
    'residential',4,'2020-01-15','081-234-5678','somchai42','somchai@example.com',
    18.7883,98.9853,'MTR-88210','0.5','ITRON','2020-01-20','2030-01-20',9875,'2023-10-01','normal'),

  (100246,'วิไลลักษณ์','แสงดาว','1-2345-67890-12-4','55/2',
    (SELECT id FROM villages WHERE name='หมู่ 3 หนองใหญ่'),
    'residential',3,'2019-06-10','082-345-6789','','',
    18.7900,98.9870,'MTR-88211','0.5','SENSUS','2019-06-15','2029-06-15',982,'2023-10-01','overdue'),

  (100247,'ปรีชา','ชลประทาน','1-2345-67890-12-5','12/9',
    (SELECT id FROM villages WHERE name='หมู่ 2 บ้านคลอง'),
    'commercial',1,'2018-03-22','083-456-7890','preecha_shop','preecha@shop.com',
    18.7860,98.9840,'MTR-88215','1.0','ELSTER','2018-04-01','2028-04-01',4310,'2023-10-01','normal'),

  (100248,'นภัสสร','รินไหล','1-2345-67890-12-6','88',
    (SELECT id FROM villages WHERE name='หมู่ 1 บ้านป่า'),
    'residential',2,'2021-09-05','084-567-8901','naphat88','',
    18.7870,98.9860,'MTR-88219','0.5','ITRON','2021-09-10','2031-09-10',2110,'2023-10-01','closed'),

  (100249,'อำนาจ','นิมิตศิลป์','1-2345-67890-12-7','124/5',
    (SELECT id FROM villages WHERE name='หมู่ 3 ท่าช้าง'),
    'residential',5,'2017-11-30','085-678-9012','','',
    18.7920,98.9890,'MTR-88222','0.5','SENSUS','2017-12-05','2027-12-05',891,'2023-10-01','overdue')
ON CONFLICT (id) DO NOTHING;

-- Reset sequence ให้ต่อจาก 100249
SELECT setval(pg_get_serial_sequence('members','id'), 100250);

-- ─── 4. Bills (total เป็น GENERATED — ห้ามใส่) ───────────────
INSERT INTO bills (
  id, member_id, period_year, period_month, period_label,
  issue_date, due_date, usage, water_charge, service_charge,
  late_fee, discount, status, sent_via
) VALUES
  ('BILL-2402-001',100245,2566,10,'ต.ค. 2566','2023-10-05','2023-10-20',25,178,20,0,0,'paid','line'),
  ('BILL-2402-002',100246,2566,10,'ต.ค. 2566','2023-10-05','2023-10-20',22,152,20,50,0,'overdue','sms'),
  ('BILL-2402-003',100247,2566,10,'ต.ค. 2566','2023-10-05','2023-10-20',69,715,30,0,0,'paid','line'),
  ('BILL-2402-004',100248,2566,10,'ต.ค. 2566','2023-10-05','2023-10-20',18,118,20,0,0,'paid','line'),
  ('BILL-2402-005',100249,2566,10,'ต.ค. 2566','2023-10-05','2023-10-20',13,76,20,150,0,'overdue','sms')
ON CONFLICT (id) DO NOTHING;

-- ─── 5. Meter Readings (usage เป็น GENERATED — ห้ามใส่) ──────
INSERT INTO meter_readings (
  id, member_id, meter_no, reading_date,
  prev_reading, curr_reading,
  water_charge, service_charge,
  method, anomaly, bill_id
) VALUES
  ('MR-66100001',100245,'MTR-88210','2023-10-01',9850,9875,178,20,'manual',NULL,'BILL-2402-001'),
  ('MR-66090001',100245,'MTR-88210','2023-09-01',9820,9850,220,20,'manual',NULL,NULL),
  ('MR-66080001',100245,'MTR-88210','2023-08-01',9788,9820,244,20,'manual',NULL,NULL),
  ('MR-66070001',100245,'MTR-88210','2023-07-01',9742,9788,412,20,'ai_scan','high_usage',NULL),
  ('MR-66060001',100245,'MTR-88210','2023-06-01',9720,9742,152,20,'manual',NULL,NULL),
  ('MR-66050001',100245,'MTR-88210','2023-05-01',9700,9720,135,20,'manual',NULL,NULL),
  ('MR-66100002',100246,'MTR-88211','2023-10-01',960,982,152,20,'manual',NULL,'BILL-2402-002'),
  ('MR-66090002',100246,'MTR-88211','2023-09-01',938,960,152,20,'manual',NULL,NULL),
  ('MR-66100003',100247,'MTR-88215','2023-10-01',4241,4310,715,30,'manual','high_usage','BILL-2402-003'),
  ('MR-66100004',100248,'MTR-88219','2023-10-01',2092,2110,118,20,'manual',NULL,'BILL-2402-004'),
  ('MR-66100005',100249,'MTR-88222','2023-10-01',878,891,76,20,'manual',NULL,'BILL-2402-005')
ON CONFLICT (id) DO NOTHING;

-- ─── 6. Payments ─────────────────────────────────────────────
INSERT INTO payments (
  id, bill_id, member_id, paid_at, amount, channel,
  tx_ref, payer_name, status, approved_at
) VALUES
  ('PAY-001','BILL-2402-001',100245,'2023-10-14 10:24:00+07',198,'promptpay',
   'REF66101400001','สมชาย รักน้ำใจ','approved','2023-10-14 10:30:00+07'),
  ('PAY-002','BILL-2402-003',100247,'2023-10-12 09:45:00+07',745,'bank',
   'REF66101200001','ปรีชา ชลประทาน','approved','2023-10-12 10:00:00+07'),
  ('PAY-003','BILL-2402-004',100248,'2023-10-13 08:12:00+07',138,'cash',
   '','นภัสสร รินไหล','approved','2023-10-13 08:15:00+07')
ON CONFLICT (id) DO NOTHING;

-- ─── 7. Water Production (nrw/nrw_pct/total_cost เป็น GENERATED) ─
INSERT INTO water_production (
  id, period_year, period_month, period_label,
  raw_water_in, water_produced, water_distributed, total_meter_usage,
  electricity_cost, chemical_cost, recorded_date
) VALUES
  ('WP-2566-10',2566,10,'ต.ค. 2566',5200,4950,4750,4580,12500,3200,'2023-10-31'),
  ('WP-2566-09',2566, 9,'ก.ย. 2566',4800,4600,4400,4200,11800,2900,'2023-09-30'),
  ('WP-2566-08',2566, 8,'ส.ค. 2566',5100,4900,4700,4480,12200,3100,'2023-08-31'),
  ('WP-2566-07',2566, 7,'ก.ค. 2566',5300,5050,4850,4600,12800,3300,'2023-07-31')
ON CONFLICT (id) DO NOTHING;

-- ─── 8. Water Quality ────────────────────────────────────────
INSERT INTO water_quality (
  id, test_date, sample_point, village_id,
  ph, turbidity, chlorine, ec, coliform, result
) VALUES
  ('WQ-001','2023-10-15','ต้นทาง',   (SELECT id FROM villages WHERE name='หมู่ 1 บ้านป่า'),  7.2,1.2,0.4,320,0,'pass'),
  ('WQ-002','2023-10-15','กลางสาย',  (SELECT id FROM villages WHERE name='หมู่ 2 บ้านคลอง'), 7.0,1.8,0.3,340,0,'pass'),
  ('WQ-003','2023-10-15','ปลายสาย',  (SELECT id FROM villages WHERE name='หมู่ 3 ท่าช้าง'),  6.9,2.1,0.2,355,0,'pass'),
  ('WQ-004','2023-09-15','ต้นทาง',   (SELECT id FROM villages WHERE name='หมู่ 1 บ้านป่า'),  7.4,1.5,0.5,310,0,'pass'),
  ('WQ-005','2023-09-15','ปลายสาย',  (SELECT id FROM villages WHERE name='หมู่ 3 หนองใหญ่'),6.7,3.2,0.1,380,2,'fail')
ON CONFLICT (id) DO NOTHING;

-- ─── 9. Maintenance ──────────────────────────────────────────
INSERT INTO maintenance_jobs (
  id, type, description, location, village_id,
  member_id, reported_by_type, reported_date,
  assigned_name, start_date, completed_date,
  materials, cost, status
) VALUES
  ('MNT-001','pipe_repair','ท่อแตกหน้าบ้านเลขที่ 42/1 หมู่ 1',
   'หมู่ 1 บ้านป่า',(SELECT id FROM villages WHERE name='หมู่ 1 บ้านป่า'),
   100245,'member','2023-10-10','ช่างสมศักดิ์','2023-10-11','2023-10-11',
   'ท่อ PVC 1 นิ้ว 5 เมตร',850,'completed'),

  ('MNT-002','meter_replace','เปลี่ยนมิเตอร์ MTR-88211 ชำรุด',
   'หมู่ 3 หนองใหญ่',(SELECT id FROM villages WHERE name='หมู่ 3 หนองใหญ่'),
   100246,'staff','2023-10-05','ช่างวิชัย','2023-10-06','2023-10-06',
   'มิเตอร์ SENSUS ½" 1 อัน',1200,'completed'),

  ('MNT-003','tank_clean','ล้างถังพักน้ำหมู่ 2',
   'หมู่ 2 บ้านคลอง',(SELECT id FROM villages WHERE name='หมู่ 2 บ้านคลอง'),
   NULL,'staff','2023-10-20','ช่างสมศักดิ์','2023-10-22',NULL,
   'สารฆ่าเชื้อ 5 ลิตร',500,'in_progress'),

  ('MNT-004','pipe_repair','ท่อรั่วบริเวณแยกหมู่ 4',
   'หมู่ 4 โคกสูง',(SELECT id FROM villages WHERE name='หมู่ 4 โคกสูง'),
   NULL,'member','2023-10-25',NULL,NULL,NULL,'',0,'pending')
ON CONFLICT (id) DO NOTHING;

-- ─── ยืนยันผล ─────────────────────────────────────────────────
SELECT 'villages'    AS tbl, COUNT(*) FROM villages
UNION ALL SELECT 'members',      COUNT(*) FROM members
UNION ALL SELECT 'bills',        COUNT(*) FROM bills
UNION ALL SELECT 'meter_readings',COUNT(*) FROM meter_readings
UNION ALL SELECT 'payments',     COUNT(*) FROM payments
UNION ALL SELECT 'maintenance',  COUNT(*) FROM maintenance_jobs
UNION ALL SELECT 'water_production',COUNT(*) FROM water_production;
