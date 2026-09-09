# P0 ＋ P1：單一播放計畫與「我的提醒」

這份文件說明 P0（單一玩家身分、適用軌道、真實句數、互斥方案、共用播放前檢查）與
P1（每個機制的「＋我的提醒」、整合列表、跨軌機制連動）的設計與取捨。

實作基準：`master` 分支，起點為 `230cbfa`（規格查核基準 `cb2b3dd` 的下一個 commit）。

---

## 1. 資料版本：V2 與 V1 的關係

### 1.1 一個事件只有一個時間來源

V2 把事件原本的 `atMs` 換成 `timing`：

```ts
type EventTiming =
  | { kind: 'absolute'; atMs: number }
  | { kind: 'mechanic'; sourceTrackId: string; sourceEventId: string };
```

`mechanic` 是**活的引用**，不是複製下來的秒數。事件上不再有第二份可獨立編輯的
`atMs`，所以不會出現「畫面顯示連動、資料其實是複本」這種狀況。

`TimelineCue.offsetMs` 保持原義：相對於所屬事件的偏移。

```
absolute eventAtMs = timing.atMs
mechanic eventAtMs = 被引用的王機制的 absolute atMs
cue.triggerMs      = eventAtMs + cue.offsetMs
```

本版只允許：**同一份文件、encounter 軌道、absolute 來源**。
不支援連鎖引用，因此循環在結構上不可能形成。

以下六種情況是**阻擋錯誤**（不是靜默忽略、也不會丟出無法處理的例外）：
自引用、來源不存在、宣告的來源軌道不符、來源不是戰鬥軌道、來源本身是連動事件、
來源時間不是有限數值。

### 1.2 唯一的解析器

`src/timeline/resolveEventTiming.ts` 是唯一的時間解析入口，以下全部走它：

| 使用者 | 檔案 |
| --- | --- |
| 編譯器 | `timeline/compiler.ts` |
| 驗證器 | `timeline/validator.ts` |
| 碰撞分析 | `timeline/collision.ts` |
| 事件排序 | `timeline/edits.ts`（`sortTrackEvents`、`insertEventSorted`） |
| 列表顯示 | `components/editor/EventTable.tsx`、`MechanicReminderList.tsx` |
| 試播 | `components/editor/MechanicReminderWorkspace.tsx` |
| 刪除前的固定時間轉換 | `timeline/edits.ts`（`removeEventSafely`） |

**沒有**用 React effect 把來源時間同步寫回子事件來冒充連動。

連動事件的 `phase` 也由來源即時解析（`resolved.phase`），所以複製後再移動來源，
不會留下過期的階段標籤。

**來源語音是否啟用、來源軌道是否勾選，都不影響錨點存在。**
`buildMechanicIndex` 一律掃整份文件，不看 `enabledTrackIds`。關掉 Boss 報點不會讓
「我的提醒」失效或位移。

### 1.3 互斥方案採明確 metadata

```ts
interface SelectionGroup { id: string; name: string; options: { id: string; name: string }[] }
// TimelinePackage 新增：selectionGroups?: SelectionGroup[]
// TimelineTrack   新增：selection?: { groupId: string; optionId: string }
//                       purpose?: 'personal-reminders'
```

互斥**只**由這份 metadata 決定。程式不看軌道名稱、職業名稱或軌道數量，
也不會把兩份既有範本自動合併成一個方案群組。

沒有 `selection` 的軌道保持獨立多選 —— 同一個學者的奶軸、輸出軸與自訂提醒可以並用。

作者設定入口在編輯器的「進階設定：互斥方案」（`SelectionGroupEditor`），
可以建立／改名／刪除群組與方案，並指定每條軌道所屬方案。

### 1.4 V1 遷移

1. V1 先用 `timelinePackageV1Schema` 做結構驗證，**通過後**才進入純函式
   `migrateV1ToV2`。結構壞掉的舊檔會報「舊版時間軸的結構不合法」，不會產生半遷移的 V2。
2. `atMs` → `{ kind: 'absolute', atMs }`，`cue.offsetMs` 原樣複製。
   **不做任何四捨五入或夾值。**
3. **不依「時間相同」或「名稱相近」把舊事件猜成連動。** 舊的獨立事件永遠是 absolute。
   `migrationBaseline.test.ts` 對全部 12 份範本斷言遷移後 `mechanic` 事件數為 0。
4. V2 直接原樣通過，不重複遷移。未知的未來版本（例如 `schemaVersion: 99`）明確拒絕，
   不吞掉不認得的欄位；呼叫端保留原始 payload 供匯出。
5. `public/timelines/*.json` **維持 V1**，由載入端遷移。沒有為了升版重寫任何奶軸內容。
6. V2 匯出保留 `timing` 引用與方案 metadata，不會攤平成 V1。本次不實作 V1 降版匯出。

### 1.5 舊 LocalStorage key

`STORAGE_PREFIX` 仍是 `ff14tc:v1`，**沒有隨 schema 升版換 key**。

軌道偏好改成按身分分開儲存：

| 用途 | key |
| --- | --- |
| 新（每身分） | `ff14tc:v1:player-prefs:<timelineId>:<position>:<job>` |
| 舊（每時間軸） | `ff14tc:v1:player-prefs:<timelineId>` |
| 繼承標記 | `ff14tc:v1:player-prefs-claimed:<timelineId>` |

舊偏好由**第一個開啟這份時間軸的身分繼承一次**，並寫下繼承標記；
之後換職業不會被重複套上同一份舊選擇。**舊 key 本身不刪除**，保持可讀。

時間軸本體只在記憶體正規化，初次載入不主動覆寫檔案。

儲存失敗（例如配額用盡）拋出 `PrefsWriteError`，畫面顯示
「儲存軌道選擇失敗，這次的設定只保留在畫面上」，記憶體中的操作結果保留，
不顯示儲存成功。

---

## 2. P0：`buildPlaybackPlan` 與統一開始

### 2.1 共用計畫

`src/timeline/playbackPlan.ts` 的 `buildPlaybackPlan(input)` 是純函式，
輸入時間軸、身分、已選軌道、本次倒數、語音設定、碰撞視窗、`maxLateMs`、
本次會生效的校時、瀏覽器是否支援語音；輸出：

- `compiledTimeline`（只在可安全編譯時提供）
- 每軌的 `applicable` / `reason` / `selected` / `enabledCueCount` / `matchingCueCount`
  / `allMatchingDisabled` / `blockedReason` / `hasTimingError`
- `selectionGroups`（每個群組的已選方案與衝突）
- `cues`、`totalCueCount`
- `errors`、`warnings`（每項都有穩定 code，盡可能帶 trackId／eventId／cueId）
- `actualCollisions`（**只**分析本次編譯後真正會播的 cues）
- `fingerprint`

篩選順序固定：

```
資料正規化／引用驗證
  → 有效目標交集（track target ∩ cue target）
  → profile 匹配與 cue.enabled
  → 軌道選擇／方案檢查
  → 解析與檢查此次可播放時間
  → deterministic compilation（沿用 compiler 原本的排序）
  → 實際 queue 碰撞分析
```

職業篩選、時間解析、數量統計、互斥檢查、碰撞分析在整個 App 只有這一份實作。
`plan.totalCueCount` 恆等於 `compiled.cues.length`，也等於各已選軌道
`enabledCueCount` 之和（`playbackPlan.test.ts` A4 斷言）。

`fingerprint` 是文件內容＋所有相關設定的 FNV-1a 雜湊，用來判斷「確認後資料是否已改變」。
它不是安全 token，也不是永久跳過檢查的憑證。

### 2.2 阻擋錯誤（errors）

| code | 說明 |
| --- | --- |
| `profile.invalid-position` / `profile.invalid-job` | 站位／職業以資料驗證，不只靠 TypeScript cast |
| `timeline.blocking-error` | schema／domain／引用錯誤 |
| `selection.conflict` | 同群組同時有多個有效方案 |
| `plan.no-cues` | 本次提示數為零 |
| `plan.cue-before-countdown` | 提示落在本次倒數涵蓋範圍之前 |
| `plan.cue-after-duration` | 提示超過時間軸結束 |
| `plan.invalid-countdown` / `plan.invalid-offset` | 不合法數值 |
| `plan.offset-skips-cues` | 校時會讓開場提示一開始就被判定過期 |
| `audio.unsupported` | 瀏覽器不支援 Web Speech API |

**校時正負號沿用引擎，沒有反轉。** 引擎的
`timelineElapsedMs = wall − countdown − effectiveOffset`，所以：

- 正校時 → 時間軸整體延後，開場不會漏
- 負校時 → 一開始就已推進，`initialElapsed = −countdown − offset`，
  任何 `initialElapsed − triggerMs > maxLateMs` 的提示會在第一個 tick 就被略過

新一場由引擎重設 `pullOffset`，所以檢查只用 `sessionOffsetMs`。
合法校時（例如 ±2 秒）不會被一律當成錯誤（`playbackPlan.test.ts` 有回歸測試）。

時間檢查一律用**使用者此次實際倒數**，不是 `timeline.encounter.countdownMs`。
倒數不足時錯誤訊息附上「改用足夠長的倒數，或回去修改這句的時間；
系統不會偷偷略過開場提示」。

### 2.3 需要確認的警告（warnings）

| code | 說明 |
| --- | --- |
| `plan.collisions` | 本次 queue 的密集提示；文案用「可能來不及唸完」 |
| `plan.job-track-unrestricted` | `type=job` 卻有不限職業的提示（提示作者可能漏填，但保留共享內容） |
| `plan.only-shared-cues` | 只有共通提醒；明說「這不等於套用了完整奶軸」 |

碰撞畫面顯示兩句文字、時間差、提示來源，以及「試播這段」與「前往調整」。
**不會**自動刪除、合併、改時間、插隊或搶占。長句警告繼續存在；
真實 TTS 長度預估不是本次功能，文案也不宣稱真實音訊必定重疊。

### 2.4 軌道顯示與句數

- 預設只顯示「適用於目前身分」的軌道
- 其他收在可展開的「不適用的軌道」，**不能勾選**並顯示原因
- 適用性用 `track target ∩ 每句 cue target`，不是只看 `track.target` 或 `track.type`；
  混合職業軌會保留其適用部分
- 已選且有效 → 「本次播放 X 句」；未選 → 「啟用後符合目前身分 X 句」
- 對象相符但全部停用 → 「0 句已啟用（共 N 句符合身分，全部停用）」，
  **不會**錯報成職業不適用
- 引用失效 → 該軌標「這條軌道有連動失效的事件，尚不可播放」，
  **不靜默刪掉錯誤 cue 讓數字看起來正常**
- 原本的「全選」改成「選取適用軌道」：只選獨立軌道與已選方案的適用軌道，
  不會同時啟用不同互斥方案；尚未選方案的群組留給使用者決定

### 2.5 統一的 `requestStart`

`src/hooks/usePlaybackStart.ts`：

```
idle 的開始按鈕／空白鍵／Quick Start
  → 讀取最新輸入快照（getPlan()，永遠不是閉包裡的舊值）
  → buildPlaybackPlan
  → errors            → stage 'blocked'，完全不啟動
  → 需確認 warnings    → stage 'risk-confirm'（Quick Start 也不可略過）
  → 無警告且非 Quick   → stage 'ready-summary'
  → 無警告且 Quick     → commitStart
  → commitStart 前再核對 request token、fingerprint 與引擎狀態
  → ownedBackend.acquireForPlayback() → engine.load() → engine.start()（只一次）
```

- `engine.load() + engine.start()` **只出現在 `commitStart` 一處**
- `startedTokenRef` 保證同一個 token 只會真正開始一次
- 確認只屬於這一次請求：`invalidate()` 由重置、離開頁面、改身分／軌道／方案／倒數呼叫；
  fingerprint 變動則把彈窗標成 `stale` 並停用確認鈕。**沒有永久略過警告的開關。**
- 彈窗開著時 `useShortcuts` 停用（`enabled: !start.modalOpen`），空白鍵不會確認風險
- `useShortcuts` 新增 `isNativelyActivated`：焦點在 `button` / `a` / `summary` /
  `label` / `[role=button]` / checkbox 上時，Space／Enter 交給瀏覽器原生行為，
  全域 handler 讓路，避免 keydown＋click 雙啟動
- `event.repeat` 早退，按住空白不會排出多場
- input／textarea／select／contenteditable 中的空白鍵是正常輸入
- `paused` 走 `engine.resume()`，恢復同一份被凍結的計畫，不重新 load、不計新場次；
  `completed` 必須先重置

**行為變更（原本是規格點名要修的不一致）**：舊版空白鍵在 idle 時直接呼叫
`beginPull()`，繞過 Ready Summary。現在三個入口完全一致。
`PlayerView.test.tsx` 對應的斷言已更新，並在註解說明原因。

---

## 3. P1-A：從機制直接追加「我的提醒」

`QuickReminderForm` 預設畫面只問兩件事：說什麼、前／後幾秒。

- 預設提前 3 秒；`機制前 N 秒 → offsetMs = −N × 1000`，`機制後 → +N × 1000`，
  `當下 → 0`（並停用秒數輸入）
- **偏移只加一次**：只寫進 `cue.offsetMs`，事件本身沒有第二份時間
- 秒數接受非負有限小數，換算為毫秒；空字串／負值／`abc` 一律擋下，
  畫面不會出現 `NaN`／`Infinity`
- 實際觸發時間即時顯示，用的是共用 resolver（機制 01:16.140 −3 秒 → 01:13.140）
- 分類（`custom`）、優先度（`normal`）、事件名稱、target 與軌道選擇由系統填入；
  正常流程沒有職業對象矩陣，也不會預設選「第一條其他軌道」

### 儲存位置

`ensurePersonalTrack` 找 `purpose === 'personal-reminders'` 且 target 恰好對應
目前單一 position／job 的軌道，沒有就建立。

- 一份時間軸、同一身分**最多一條**系統個人提醒軌道；反覆新增與連點都只復用
  （驗證器有 `track.duplicate-personal-track` 阻擋錯誤）
- 這種軌道必須有精確的單一 position／job target（`track.personal-target-not-exact`）
- 複製這種軌道時會**移除系統 purpose**，變成一般自訂軌，內容與 target 保留
- 新 cue：`enabled = true`、`priority = 'normal'`、**沒有** per-cue target
  （對象完全由軌道 target 決定），不會繼承 Boss 的「所有人」或別的職業
- 建立 `mechanic` 引用，不是複製秒數
- 建立軌道與新增提醒是**同一次文件替換**，一次 undo 可撤銷整個新增
  （含必要的空新軌道）
- 明確提示「已加入我的自訂提醒」；軌道關閉時提供「同時啟用」選項，
  並提醒「關閉時儲存了也不會播」

### 內建範本唯讀

內建時間軸現在**可以直接用「＋我的提醒」**。第一次儲存時：

1. `forkTimeline` 產生全新 ID 的本機複本，第二遍重映射所有內部引用
2. 用 `trackIdMap` / `eventIdMap` 把提醒指向**複本裡對應的王機制**
3. 存檔並切換到複本，同時顯示「已建立本機複本，並把提醒加入『我的自訂提醒』」

儲存前試聽**不會**建立持久複本（草稿只存在記憶體副本）。
取消不留下空軌道或半成品。儲存失敗保留輸入並顯示錯誤，不虛報成功。

### 進階面板

`MechanicActionPanel` 保留，但新增「時間關係」下拉，明確區分：

- **連動到來源機制**（預設）—— 機制移動時跟著移動
- **固定時間** —— 只複製目前秒數，之後不跟著移動

原本那個「複製秒數卻宣稱有連動」的 helper 已經不存在了。

---

## 4. P1-B：整合列表、直接修改與引用安全

`MechanicReminderList` 欄位：時間｜來源｜我的提醒｜前／後幾秒｜啟用｜操作。

- 依 resolver 後的時間排序；可依階段與機制名稱／提醒文字篩選
- 每個機制底下只顯示**真正引用它**且適用目前 profile 的提醒，可多句，
  並顯示所屬軌道
- 共通提示標「共通」（附適用對象 tooltip），個人提示標「我的」
- **共享 cue 不能用快捷操作改寫**：那一列的啟用勾選停用、沒有「編輯」「刪除」，
  只有「進階編輯」
- 既有 absolute 提醒歸入「固定時間／尚未連動」區塊，仍可直接編輯；
  **不會**只因秒數相同或名稱相近就自動歸屬某個機制
- 「連動至機制…」是明確操作：選來源後，以舊 `triggerMs` 反算新 offset，
  預設保持實際觸發時刻不變，**確認後**才變更模型
- 直接修改文字／前後秒數／啟用狀態，走同一套 validation、autosave 與 undo/redo
- Enter 送出、Esc 取消目前行編輯；輸入中 `stopPropagation`，空白鍵不控制播放器；
  半成品值（例如只打了一個 `-`）不寫進領域物件
- **一次行編輯 = 一次 undo**：草稿存在元件的 local state，只在 Enter／完成時
  呼叫一次 `onEditReminder`，不是每打一個字就一個編輯動作

### 移動、刪除與複製

**移動來源**：所有關聯提醒由 resolver 自動更新，offset 不變。超出範圍由驗證器
明確標錯（`event.after-duration`），**不靜默夾值**。

**刪除有引用的機制／軌道**：`DeleteDependentsDialog` 列出**所有**受影響提醒，
包含目前 profile 看不到的（例如另一個職業的），三種處理：

1. **取消**（預設）
2. 一併刪除相關提醒
3. 轉成固定時間再刪除來源 —— 先在**舊文件**解析 `eventAtMs`，
   把 dependent timing 改成 absolute，保留原 `cue.offsetMs`，
   確保實際 `triggerMs` 不變（並凍結當時顯示的 phase）

每種策略都是一次文件替換，一次 undo 還原全部。
**所有刪除入口都走這條路** —— `EventTable` 與 `TrackList` 現在也是
`onRequestDeleteEvent` / `onRequestDeleteTrack`，由 `EditorPage` 統一處理，
不是只有新畫面安全。

**複製規則**

| 操作 | 行為 |
| --- | --- |
| 整份 fork | track／event／cue 全部新 ID，第二遍重映射所有內部引用，不指向原文件 |
| 複製單個提醒 | 新 event／cue ID，仍關聯同一來源機制 |
| 複製單個來源機制 | 既有提醒繼續關聯**舊**機制，不自動搬到複製品 |
| 複製軌道 | 該範圍內的來源重映射到複本自己；範圍外的仍指向同一文件內原機制 |
| 複製個人提醒軌道 | 移除系統 purpose，按一般自訂軌處理 |

---

## 5. 試聽、片段試播與音訊互斥

### 單句試聽

用 cue **實際解析後**的 audio config（含每句覆蓋值），不只是全域預設。
可停止；連續點擊會先停止上一段，不無限疊加。不支援語音或出錯時顯示可讀回饋。
文案明說「送出不代表你一定聽到了」。

### 片段試播

- 以選中提醒的實際 `triggerMs` 為中心，預設前後各 5 秒，夾在
  `[−本次倒數, durationMs]`
- 只包含目前 profile／選軌／方案下**真正會播**的 cues（含鄰近共通提示，
  才聽得出碰撞）
- 新增中的草稿加進**記憶體副本**並參與同一套編譯／碰撞流程，
  **不需要先寫入 storage**
- 草稿所在的個人軌道若關閉，預覽副本會暫時打開它，並在面板標示
  「預覽使用編輯時間軸座標，不套用本場校時」；**不修改正式偏好**
- 按正常 1 倍時間關係播放：`PreviewController` 有自己的 clock／ticker，
  依 `triggerMs` 逐句派送，不是一次全送、也不從 0 秒跑起
- 區間終點停止新增 cue，`drainMs` 後收工；另有「停止預覽」按鈕；
  停止／離開立即取消剩餘語音與排程
- 預覽採編輯時間軸座標，**不疊加**正式 session／pull 校時
- 結構／引用錯誤會停止預覽；**密集提示警告不會**要求正式開場確認
  （否則沒辦法用試聽排查碰撞）

### 音訊 ownership

單純建立第二個 `BrowserTtsBackend` **不構成隔離** —— 兩者操作同一個
`window.speechSynthesis`，任一方 `cancel()` 都會殺掉對方。所以改用應用層仲裁：

`AudioOwnershipManager` 同時最多一個 owner，優先度
`playback > segment-preview > cue-preview > settings-preview`。

- 正式 running／countdown／paused 時，編輯試聽被拒絕並顯示
  「正式播放進行中，請先重置或等這一場結束」
- 正式結束（idle／completed）時 `useTimelineEngine` 釋放 lease，預覽才能取得
- 正式開始前 `commitStart` 先 `acquireForPlayback()`（會清掉預覽殘留），
  **再** `engine.load()`，讓 `prepare()` 的 Chrome 暖機在持有裝置時執行
- **`OwnedAudioBackend`** 是關鍵：引擎在 idle 時的 `load()`（輸入一變就會跑）
  會呼叫 `cancelAll()` 與 `prepare()`，兩者在沒有 lease 時**一律不轉發**，
  所以掛載播放器不會取消正在進行的編輯試聽
- 被撤銷的 owner 只停自己的 ticker 與隊列，**不呼叫 `cancelAll`**
  （那時新主人可能已經在講話）；清隊列由接手者在 `onAcquire` 做一次
- 非同步舊回呼用 `runToken` 作廢，停止／切頁後不會再播或再 cancel
- 預覽用可注入的 Clock／Ticker，不觸碰真實引擎的 `pullId`、snapshot 或 recorder
- 只做同一個 App 實例內的互斥，沒有跨分頁／跨裝置同步

---

## 6. 新增與修改的檔案

### 新增

| 檔案 | 職責 |
| --- | --- |
| `timeline/resolveEventTiming.ts` | 唯一的時間解析與引用檢查 |
| `timeline/playbackPlan.ts` | 共用播放計畫、適用性、句數與 preflight |
| `timeline/selectionGroups.ts` | 方案分析、互斥規則、作者端編輯 |
| `timeline/personalReminders.ts` | 個人提醒軌道、快速追加、驗證 |
| `hooks/usePlaybackStart.ts` | 統一開始控制器 |
| `audio/AudioOwnership.ts` | 音訊 ownership 仲裁 |
| `audio/OwnedAudioBackend.ts` | 擋住沒有 lease 的 `prepare`／`cancelAll` |
| `preview/PreviewController.ts` | 片段／單句預覽，獨立 clock／ticker |
| `components/player/PreflightDialog.tsx` | blocked／risk-confirm／ready-summary 三合一 |
| `components/player/SelectionGroupPicker.tsx` | 方案單選 UI |
| `components/editor/QuickReminderForm.tsx` | 「＋我的提醒」表單 |
| `components/editor/MechanicReminderList.tsx` | 機制＋我的提醒整合列表 |
| `components/editor/MechanicReminderWorkspace.tsx` | P1 工作區（列表＋表單＋對話框＋預覽） |
| `components/editor/ReferenceSafetyDialogs.tsx` | 刪除三選一、連動至機制 |
| `components/editor/SelectionGroupEditor.tsx` | 方案群組作者設定 |
| `test/planFixtures.ts` | 測試用 builder 與混合職業／互斥範例 |
| `test/baseline/compiledBaseline.json` | **V2 之前**產生的編譯基準（6048 組案例） |

### 主要修改

| 檔案 | 修改 |
| --- | --- |
| `timeline/types.ts` | `EventTiming`、`SelectionGroup`、`TrackPurpose`、`schemaVersion: 2`、V1 型別 |
| `timeline/schema.ts` | V2 schema（discriminated union）＋保留 V1 schema 作遷移輸入 |
| `timeline/migration.ts` | V1 結構驗證 → 純函式 `migrateV1ToV2`；拒絕未知版本 |
| `timeline/validator.ts` | 改用 resolver；新增引用、方案、個人軌道唯一性檢查 |
| `timeline/compiler.ts` | 改用 resolver；`eventAtMs`／`phase` 由解析結果決定 |
| `timeline/collision.ts` | 改用 resolver |
| `timeline/edits.ts` | 引用安全刪除、複製重映射、`forkTimeline`、連動／固定時間轉換 |
| `storage/settings.ts` | 每身分偏好、舊 key 一次性繼承、`PrefsWriteError`、`pruneEnabledTrackIds` |
| `hooks/useTimelineEngine.ts` | 包 `OwnedAudioBackend`、暴露 ownership、結束時釋放 |
| `hooks/useShortcuts.ts` | 原生按鈕讓路，避免 Space 雙啟動 |
| `components/player/PlayerView.tsx` | 全面改用 plan＋`usePlaybackStart` |
| `components/player/TrackSelector.tsx` | 適用性、真實句數、「選取適用軌道」 |
| `components/editor/EventDetail.tsx` | 連動事件顯示來源與唯讀時間、可轉固定時間 |
| `components/editor/EventTable.tsx` | resolver 時間、連動標記、刪除改為請求 |
| `components/editor/TrackList.tsx` | 刪除改為請求 |
| `components/editor/MechanicActionPanel.tsx` | 新增「連動／固定時間」模式選擇 |
| `pages/EditorPage.tsx` | 掛入工作區、方案設定、統一刪除對話框 |
| `package.json` | 修掉 `typecheck` 腳本（原本會 emit `.js` 並在 TS5096 失敗） |

### 保持不變

純前端、GitHub Pages／HashRouter、瀏覽器儲存，以及
domain／compiler／engine／audio 分層。React 仍然只消費引擎，不是計時來源。
沒有新增後端、登入、團隊同步、AI 生成、拖曳編輯器、冷卻模擬，
也沒有 ACT／封包／OCR／全域熱鍵。沒有新增大型依賴、沒有升版主要依賴、
沒有改變部署方式。介面全繁體中文。

---

## 7. 已知限制

- 碰撞判斷只用文字長度（CJK 1、其餘 0.5）與固定視窗估算，
  **不代表真實語音一定重疊**。真實 TTS 長度預估不是本次功能。
- `mechanic` 引用只支援同文件、encounter 軌道、absolute 來源，不支援連鎖。
- 本次不實作 V1 降版匯出。
- 音訊互斥只在同一個 App 實例內；不做跨分頁或跨裝置。
- **格式檢查與碰撞檢查都不等於奶軸實戰正確。** 這些工具只能告訴你
  「資料結構沒問題」「這兩句可能太近」，不能告訴你這個奶軸在副本裡打得動。
