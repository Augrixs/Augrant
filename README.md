# Augrant

แอปทำคลิป rant แนวตั้ง: อัปโหลดเสียงกับวิดีโอพื้นหลัง ถอดเสียงเป็นคำบรรยายที่เปลี่ยนสีทีละคำ ตัดต่อ แล้ว Export
มีระบบ Log in (แอดมินสร้างบัญชีให้) และแท็บ Admin Panel Augrixs Rant ที่เห็นเฉพาะแอดมิน

ขั้นตอนตั้งค่าทั้งหมดอยู่ใน [SETUP.md](SETUP.md)

```
src/core      ตรรกะล้วน (ตัดต่อ, จัดคำบรรยาย) มีเทสต์ใน tests/
src/engine    เสียง, เครื่องเล่น, ถอดเสียง Whisper, Export
src/ui        หน้าจอทั้งหมด
supabase/     setup.sql และฟังก์ชัน admin
native/       ปลั๊กอินแอนดรอยด์ ไอคอน คีย์เซ็นไฟล์
scripts/      patch_android.py
.github/      build.yml สร้างไฟล์ .apk
```
