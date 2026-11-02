# ตั้งค่า Augrant ทีละขั้น

ทำตามลำดับ ทุกอย่างทำจากเว็บได้ ไม่ต้องลงโปรแกรมในคอม

## ส่วน A. Supabase (ฐานข้อมูลและบัญชี)

### A1. สร้างตารางและกฎความปลอดภัย
1. เปิดโปรเจกต์ Supabase ของคุณ แล้วไปที่ **SQL Editor** > **New query**
2. เปิดไฟล์ `supabase/setup.sql` ใน GitHub กดปุ่มคัดลอกทั้งไฟล์ แล้ววางในช่อง Query
3. กด **Run** ต้องขึ้นว่า Success

### A2. สร้างบัญชีแอดมินของคุณ (มีคนเดียว)
1. ไปที่ **Authentication** > **Users** > **Add user** > **Create new user**
2. Email ใส่ `augrixs@augrant.app` (อีเมลนี้ไม่ต้องมีจริง แอปใช้แค่ส่วนหน้า @ เป็น username ตอน Log in พิมพ์ Augrixs ตัวใหญ่หรือเล็กก็ได้)
3. ตั้งรหัสผ่านที่ยาว เดายาก และไม่ซ้ำกับที่อื่น
4. ติ๊ก **Auto Confirm User** แล้วกดสร้าง
5. กลับไป **SQL Editor** วางคำสั่งนี้ (ใส่ชื่อ augrixs ไว้ให้แล้ว ไม่ต้องแก้) แล้วกด Run

```sql
insert into public.profiles (id, username, display_name, role)
  select id, 'augrixs', 'Augrixs', 'admin' from auth.users where email = 'augrixs@augrant.app'
  on conflict (id) do update set role = 'admin';
```

ต้องขึ้น `Success. 1 row affected` ถ้าขึ้น 0 rows แปลว่าอีเมลในข้อ 2 สะกดไม่ตรงกับ `augrixs@augrant.app`

บัญชีนี้เป็นบัญชีเดียวที่เป็นแอดมิน บัญชีที่สร้างจากแท็บ Admin จะเป็นผู้ใช้ทั่วไปเสมอ จึงไม่เห็นแท็บ Admin

### A3. ติดตั้งฟังก์ชันสร้างและลบบัญชี
1. ไปที่ **Edge Functions** > **Deploy a new function** > **Via Editor**
2. ตั้งชื่อว่า `admin` (ตัวพิมพ์เล็กทั้งหมด)
3. ลบโค้ดตัวอย่างทิ้ง แล้ววางเนื้อหาไฟล์ `supabase/functions/admin/index.ts`
4. กด **Deploy** ปล่อยตัวเลือก Verify JWT ไว้ตามค่าเริ่มต้น

### A4. ปิดการสมัครเอง
1. ไปที่ **Authentication** แล้วหาหน้าตั้งค่าที่เกี่ยวกับ Sign In หรือ Providers (ชื่อเมนูอาจต่างกันตามเวอร์ชัน)
2. ปิด **Allow new users to sign up**
3. กด Save

ขั้นนี้สำคัญ เพราะกุญแจที่อยู่ในแอปเป็นกุญแจสาธารณะ ถ้าไม่ปิด คนอื่นจะลองสมัครบัญชีเองได้ (สมัครได้แต่เข้าใช้งานจริงไม่ได้ เพราะไม่มีโปรไฟล์) การสร้างบัญชีจากแท็บ Admin ยังทำงานได้ตามปกติแม้ปิดไว้

## ส่วน B. สร้างไฟล์ .apk ด้วย GitHub

1. เปิด repository `Augrixs/Augrant` ไปที่แท็บ **Actions**
2. ถ้ามีปุ่มเปิดใช้ Workflows ให้กดอนุญาต
3. เลือก **Build APK** ด้านซ้าย แล้วกด **Run workflow** (ถ้ามีงานรันอยู่แล้วจากการอัปโหลดโค้ด รอให้เสร็จ)
4. รอประมาณ 10-20 นาที จนขึ้นเครื่องหมายถูกสีเขียว
5. กดเข้าไปที่งานนั้น เลื่อนลงล่างสุดที่หัวข้อ **Artifacts** กด **Augrant-APK** เพื่อโหลด (ได้ไฟล์ zip ให้แตกออกก่อน ข้างในคือ `app-debug.apk`)

ถ้าขึ้นกากบาทสีแดง ส่งภาพหน้าจอหรือข้อความสีแดงในขั้นที่พลาดมาให้ผม

## ส่วน C. ติดตั้งบนมือถือ

1. เปิดไฟล์ `app-debug.apk` ในมือถือ
2. ถ้าระบบถามเรื่องติดตั้งจากแหล่งอื่น ให้เปิดสิทธิ์ให้แอปที่ใช้เปิดไฟล์ (เช่น Files หรือ Chrome)
3. ถ้า Play Protect เตือน กด **ติดตั้งต่อไป** เพราะแอปนี้ไม่ได้มาจาก Play Store
4. เปิดแอป Log in ด้วย username (ส่วนหน้า @) กับรหัสผ่านที่ตั้งไว้ในข้อ A2
5. เมื่อกด Create A Videos ครั้งแรกจะมีหน้าต่างขอสิทธิ์วิดีโอและเสียง กดอนุญาต

บิลด์ครั้งต่อไปติดตั้งทับของเดิมได้เลย ไม่ต้องลบแอป ข้อมูลล็อกอินจะยังอยู่

## ส่วน D. สร้างบัญชีให้เพื่อน

1. Log in ด้วยบัญชีแอดมิน จะเห็นแท็บ **Admin** ที่แถบล่าง (บัญชีอื่นไม่เห็นแท็บนี้)
2. กรอก username, ชื่อเล่น และรหัสผ่าน (อย่างน้อย 8 ตัว) แล้วกด **สร้างบัญชี**
3. ส่งไฟล์ .apk กับ username และรหัสผ่านให้เพื่อน
4. กดที่ชื่อบัญชีเพื่อดูเวลาเข้า-ออกแอป คลิปที่สร้าง ทำอะไรล่าสุด เปลี่ยน username ตั้งรหัสผ่านใหม่ หรือลบบัญชี

บอกเพื่อนก่อนว่าแอปบันทึกเวลาเข้า-ออกและคลิปที่สร้าง ในหน้า Log in มีข้อความแจ้งไว้แล้ว

## สิ่งที่ควรรู้

- ถอดเสียงครั้งแรกต้องต่ออินเทอร์เน็ตเพื่อโหลดโมเดล (ราว 40-150 MB ตามที่เลือกในหน้า Settings) ครั้งต่อไปโหลดซ้ำน้อยลง
- Export วิดีโอใช้เวลาเท่าความยาวคลิป ห้ามสลับแอปและห้ามปิดหน้าจอ ถ้าค้างให้ลดความละเอียด
- เสียงที่ได้ในไฟล์ Export คือเสียงจากไฟล์ที่อัปโหลดผสมกับเสียงวิดีโอพื้นหลัง
- ไฟล์ `native/debug.keystore` เป็นกุญแจเซ็นไฟล์สำหรับติดตั้งเอง ใช้ติดตั้งนอก Play Store เท่านั้น เก็บ repository เป็น Private ไว้

## Social features (friends, posts, chat, inbox)

Run `supabase/social.sql` once: Supabase > SQL Editor > New query > paste the whole file > Run.
It adds friends, chat, posts, likes, comments, notifications and the `posts` storage bucket for pictures and videos.
Without it the Social, Post, Inbox and Chat tabs show errors.

## Version 1.1: sign up, Google, email codes

1. Run `supabase/accounts.sql` in the SQL Editor (once).
2. Supabase > Authentication > Sign In / Providers > Email: turn on, and turn on "Confirm email".
   Turn OFF "Secure email change" (accounts made by the admin have no real email to confirm with).
3. Authentication > Email Templates: in **Confirm signup**, **Magic Link** and **Change Email Address** put the
   code in the message, for example:  `Your Augrant code: {{ .Token }}`
4. Authentication > SMTP Settings: set your own SMTP (Brevo, Resend, Gmail app password...).
   The built-in sender only allows a few emails per hour, so friends will not get their codes.
5. Google: Google Cloud Console > APIs & Services > Credentials > OAuth client ID (Web application).
   Authorized redirect URI: `https://rqnbkhgayhcxxvjkkwej.supabase.co/auth/v1/callback`.
   Put the Client ID and Secret in Supabase > Authentication > Sign In / Providers > Google.
6. Authentication > URL Configuration: Site URL `https://augrixs.github.io/Augrant/`;
   Redirect URLs: add `https://augrixs.github.io/Augrant/` and `com.augrixs.augrant://auth`.
