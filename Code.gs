// ================================================================
//  Defect System API — Google Apps Script Web App
//
//  열 구조 (시트1):
//  A=ID  B=Time(before)  C=Time(after)  D=Tower  E=Floor  F=Room
//  G=Room detailed  H=Works(CIV/MEP/Safety)  I=Work category
//  J=Description(O)  K=Description(E)  L=PIC
//  M=Photo(before)  N=Photo(after)  O=Status  P=approved  Q=Project
//
//  배포 방법:
//  1. https://script.google.com → 새 프로젝트 → 코드 붙여넣기
//  2. 배포 → 새 배포 → 웹 앱
//     · 다음 사용자로 실행: 나
//     · 액세스 권한: 모든 사용자(익명 포함)
//  3. 배포 URL → action.html 의 APPS_SCRIPT_URL 에 붙여넣기
// ================================================================

const DRIVE_FOLDER_ID  = '10ypbcrEMU5ckFTI3mXwJPYoKu63sMc5-ZQLSioBMRIOlaaPRBuG9KVm19S14J3i9I_gM0w8c'; // 기본 폴더 (미사용)
const BEFORE_FOLDER_ID = '1ungRxOEUBncBizfGlCTLheEUuxL1QFlSTia3EyPQHNU9aQbCSEt2mWsfNNcBVOfLboX6SJYA'; // Before 사진 폴더
const AFTER_FOLDER_ID  = '15B3unpTfgfKir48GGrVoXaE_eFCynu8hATWYTmT6GguGf7TF4CUH0HlHLsMFBb6QUDpfotnY'; // After 사진 폴더
const RECORD_SHEET_ID = '1t_feuRxrgQYyKw7PoplyPcyWa73A8lIVq7fHvrLhaIY';
const SHEET_NAME      = '시트1';

// 열 번호 (1-based, getRange 용)
const COL = {
  ID:           1,   // A
  TIME_BEFORE:  2,   // B
  TIME_AFTER:   3,   // C
  TOWER:        4,   // D
  FLOOR:        5,   // E
  ROOM:         6,   // F
  ROOM_DETAIL:  7,   // G
  WORKS:        8,   // H  ← Works (CIV/MEP/Safety)
  WORK_CAT:     9,   // I  ← Work Category (Ricons/Eunmin S&D 등)
  DESC_O:       10,  // J  ← Description 원문
  DESC_E:       11,  // K  ← Description 영어 번역
  PIC:          12,  // L  ← Person In Charge
  PHOTO_BEFORE: 13,  // M  ← Photo(before)
  PHOTO_AFTER:  14,  // N  ← Photo(after)
  STATUS:       15,  // O  ← Status
  APPROVED:     16,  // P  ← approved
  PROJECT:      17,  // Q  ← Project (K8HH1 / K8CT1)
};

// ----------------------------------------------------------------
//  날짜 포맷 헬퍼 → "2026.3.16 13:50:17"
// ----------------------------------------------------------------
function formatDateTime(d) {
  const pad = n => String(n).padStart(2, '0');
  return d.getFullYear() + '.' + (d.getMonth() + 1) + '.' + d.getDate()
       + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

// ----------------------------------------------------------------
//  CORS 헬퍼 — 모든 응답에 공통 적용
// ----------------------------------------------------------------
function corsResponse(obj) {
  const output = ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
  return output;
}

// ----------------------------------------------------------------
//  GET — 헬스체크 / AppSheet URL 파라미터 확인용
// ----------------------------------------------------------------
function doGet(e) {
  const id = e && e.parameter && e.parameter.id ? e.parameter.id : null;
  return corsResponse({
    ok: true,
    message: 'Defect Action API is running.',
    receivedId: id,
    timestamp: new Date().toISOString(),
  });
}

// ----------------------------------------------------------------
//  POST — 메인 핸들러
//  payload.type = 'action'  : 하자 조치 (After 사진 + ID 매칭)
//  payload.type = 'report'  : 하자 접수 (Before 사진 + 신규 행 추가)
// ----------------------------------------------------------------
function doPost(e) {
  try {
    const raw     = e.postData.contents;
    const payload = JSON.parse(raw);
    Logger.log('doPost type=' + payload.type + ' id=' + payload.recordId);

    if (payload.type === 'action') {
      return handleAction(payload);
    } else if (payload.type === 'report') {
      return handleReport(payload);
    } else {
      throw new Error('Unknown type: ' + payload.type);
    }

  } catch (err) {
    Logger.log('doPost error: ' + err.toString());
    return corsResponse({ ok: false, error: err.toString() });
  }
}

// ----------------------------------------------------------------
//  handleAction — After 사진 업로드 + 기존 행 업데이트
// ----------------------------------------------------------------
function handleAction(p) {
  const { fileBase64, fileName, mimeType, recordId } = p;

  if (!recordId) throw new Error('recordId is required');
  if (!fileBase64) throw new Error('fileBase64 is required');

  // 1. After 사진 파일명 생성: YYMMDDHHMM_Tower_WorkCat_Floor_Room_RoomDetailed_After.ext
  //    payload에 필드가 없는 경우(Quick Mode) recordId 에서 파싱
  const parts = recordId.split('/');
  const sanitize = s => (s || '').replace(/[\/\\:*?"<>|]/g, '').trim();
  const tower      = sanitize(p.tower       || parts[0] || '');
  const floor      = sanitize(p.floor       || parts[1] || '');
  const roomDetail = sanitize(p.roomDetail  || parts[3] || '');
  const workCat    = sanitize(p.workCategory|| parts[4] || '');
  const room       = sanitize(parts[2] || '');

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const ts  = String(now.getFullYear()).slice(2)
            + pad(now.getMonth() + 1)
            + pad(now.getDate())
            + pad(now.getHours())
            + pad(now.getMinutes());
  const ext = (fileName || 'jpg').split('.').pop() || 'jpg';
  const customName = [ts, tower, workCat, floor, room, roomDetail, 'After'].join('_') + '.' + ext;

  const fileUrl = uploadToDrive(fileBase64, customName, mimeType, 'after', AFTER_FOLDER_ID);

  // 2. Sheet에서 ID 매칭 후 행 업데이트
  const sheet  = getSheet();
  const values = sheet.getDataRange().getValues();
  let   updated = false;
  let   updatedRow = -1;

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][COL.ID - 1]).trim() === String(recordId).trim()) {
      const row = i + 1; // 1-based
      sheet.getRange(row, COL.TIME_AFTER ).setValue(formatDateTime(new Date()));  // C: Time(after)
      sheet.getRange(row, COL.PHOTO_AFTER).setValue(fileUrl);     // M: Photo(after)
      sheet.getRange(row, COL.STATUS     ).setValue('Finished');  // N: Status
      updated    = true;
      updatedRow = row;
      break;
    }
  }

  if (!updated) {
    Logger.log('ID not found: ' + recordId);
  }

  return corsResponse({ ok: true, url: fileUrl, updated, updatedRow });
}

// ----------------------------------------------------------------
//  handleReport — Before 사진 업로드 + 신규 행 추가
// ----------------------------------------------------------------
function handleReport(p) {
  const { fileBase64, fileName, mimeType,
          project, tower, floor, room, roomDetail, works, workCategory, pic, description } = p;

  // 1. Before 사진 파일명 생성: YYMMDDHHMM_Tower_WorkCat_Floor_Room_RoomDetailed_Before.ext
  let fileUrl = '';
  if (fileBase64) {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const ts  = String(now.getFullYear()).slice(2)
              + pad(now.getMonth() + 1)
              + pad(now.getDate())
              + pad(now.getHours())
              + pad(now.getMinutes());
    const sanitize = s => (s || '').replace(/[\/\\:*?"<>|]/g, '').trim();
    const ext      = (fileName || 'jpg').split('.').pop() || 'jpg';
    const customName = [
      ts,
      sanitize(tower),
      sanitize(workCategory),
      sanitize(floor),
      sanitize(room),
      sanitize(roomDetail),
      'Before',
    ].join('_') + '.' + ext;

    fileUrl = uploadToDrive(fileBase64, customName, mimeType, 'before', BEFORE_FOLDER_ID);
  }

  // 2. Description 영어 번역
  let descEng = '';
  if (description) {
    try {
      descEng = LanguageApp.translate(description, '', 'en');
    } catch (e) {
      Logger.log('Translation failed: ' + e.toString());
      descEng = description;
    }
  }

  // 3. ID 생성 (Tower/Floor/Room/RoomDetail/Works/WorkCat/Desc/timestamp)
  const excelTs  = (new Date().getTime() / 86400000) + 25569;
  const recordId = [
    tower || '', floor || '', room || '',
    roomDetail || '', works || '', workCategory || '',
    description || '', excelTs.toFixed(10),
  ].join('/');

  // 4. 신규 행 추가
  const sheet = getSheet();
  sheet.appendRow([
    recordId,                   // A (1):  ID
    formatDateTime(new Date()), // B (2):  Time(before)
    '',                         // C (3):  Time(after)
    tower        || '',         // D (4):  Tower
    floor        || '',         // E (5):  Floor
    room         || '',         // F (6):  Room
    roomDetail   || '',         // G (7):  Room detailed
    works        || '',         // H (8):  Works (CIV/MEP/Safety)
    workCategory || '',         // I (9):  Work category (Ricons/Eunmin S&D 등)
    description  || '',         // J (10): Description 원문
    descEng,                    // K (11): Description 영어 번역
    pic          || '',         // L (12): Person In Charge
    fileUrl,                    // M (13): Photo(before)
    '',                         // N (14): Photo(after)
    'To be',                    // O (15): Status
    '',                         // P (16): approved
    project      || '',         // Q (17): Project (K8HH1/K8CT1)
  ]);

  return corsResponse({ ok: true, url: fileUrl, recordId });
}

// ----------------------------------------------------------------
//  Drive 업로드 헬퍼
//  folderId 생략 시 기본 폴더(DRIVE_FOLDER_ID) 사용
// ----------------------------------------------------------------
function uploadToDrive(base64, fileName, mimeType, prefix, folderId) {
  const decoded  = Utilities.base64Decode(base64);
  const name     = fileName || ((prefix || '') + '_photo_' + Date.now() + '.jpg');
  const blob     = Utilities.newBlob(decoded, mimeType || 'image/jpeg', name);
  const folder   = DriveApp.getFolderById(folderId || DRIVE_FOLDER_ID);
  const file     = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return 'https://drive.google.com/open?id=' + file.getId();
}

// ----------------------------------------------------------------
//  Sheet 핼퍼
// ----------------------------------------------------------------
function getSheet() {
  const ss = SpreadsheetApp.openById(RECORD_SHEET_ID);
  const sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) throw new Error('Sheet "' + SHEET_NAME + '" not found');
  return sh;
}
