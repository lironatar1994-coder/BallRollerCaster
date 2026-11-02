// English / Hebrew. English text is the key; Hebrew comes from the table below.
let lang = 'en';
export const setLang = (l) => { lang = l === 'he' ? 'he' : 'en'; };
export const getLang = () => lang;
export function L(s, ...a) {
  const t = lang === 'he' && HE[s] !== undefined ? HE[s] : s;
  return a.length ? t.replace(/\{(\d)\}/g, (_, i) => a[i]) : t;
}
// elements with data-i18n (text), data-i18n-html (markup) or data-i18n-title (tooltip)
export function applyStatic() {
  document.querySelectorAll('[data-i18n]').forEach(el => { el.dataset.en ??= el.textContent; el.textContent = L(el.dataset.en); });
  document.querySelectorAll('[data-i18n-html]').forEach(el => { el.dataset.en ??= el.innerHTML; el.innerHTML = L(el.dataset.en.trim()); });
  document.querySelectorAll('[data-i18n-title]').forEach(el => { el.dataset.ent ??= el.title; el.title = L(el.dataset.ent); });
}

const HE = {
  // top bar
  'Build': 'בנייה', 'Chase': 'מעקב', 'Ride': 'נסיעה', 'Movie': 'סרט', 'Release': 'שחרר', 'Auto': 'אוטומטי', 'Clear': 'נקה',
  'Replay': 'שידור חוזר', 'Challenges': 'אתגרים', 'Predict': 'תחזית',
  'Build view · 1': 'מבט בנייה · 1', 'Chase a ball · 2': 'מעקב אחרי כדור · 2', 'Ride inside a ball · 3': 'נסיעה בתוך כדור · 3', 'Movie camera with automatic shots · 4': 'מצלמת סרט עם צילומים אוטומטיים · 4',
  'Release a ball from every start · Space': 'שחרור כדור מכל מגדל · רווח', 'Ball type': 'סוג כדור', 'Keep releasing balls': 'לשחרר כדורים כל הזמן', 'Pause · P': 'עצירה · P',
  'Time speed': 'מהירות הזמן', 'Remove all balls · C': 'הסרת כל הכדורים · C', 'Instant replay of the last seconds · M': 'שידור חוזר של השניות האחרונות · M',
  'Missions with stars': 'משימות עם כוכבים', 'Show where a ball will go': 'להראות לאן הכדור ילך', 'Undo · Ctrl+Z': 'ביטול · Ctrl+Z', 'Redo · Ctrl+Y': 'חזרה · Ctrl+Y',
  'Photo mode · K': 'מצב צילום · K', 'Day / night · N': 'יום / לילה · N', 'Music': 'מוזיקה', 'Sound on/off': 'צלילים', 'Language': 'שפה', 'How to play · H': 'איך משחקים · H', 'Menu': 'תפריט',
  'Show / hide the info panel · I': 'הצגה / הסתרה של לוח המידע · I',
  // dock
  'Tracks': 'מסלולים', 'Thrills': 'אטרקציות', 'Catch & score': 'תפיסה ושערים',
  'Select': 'בחירה', 'Drop Ball': 'הפלת כדור', 'Connect': 'חיבור', 'Eraser': 'מחק', 'Connector': 'מחבר',
  'Start Tower': 'מגדל התחלה', 'Straight': 'ישר', 'Curve Left': 'פנייה שמאלה', 'Curve Right': 'פנייה ימינה', 'Spiral Left': 'ספירלה שמאלה', 'Spiral Right': 'ספירלה ימינה',
  'Drop Tube': 'צינור נפילה', 'Tunnel': 'מנהרה', 'Loop': 'לולאה', 'Jump Ramp': 'קפיצה', 'Flip-Flop': 'מפצל', 'Xylophone': 'קסילופון', 'Lift': 'מעלית', 'Funnel': 'משפך',
  'Water Wheel': 'גלגל מים', 'Seesaw': 'נדנדה', 'Goal Cup': 'כוס שער', 'Catcher': 'תופס', 'Basket': 'סל', 'Trampoline': 'טרמפולינה', 'Dominoes': 'דומינו', 'Bell': 'פעמון', 'Bumper': 'פגוש',
  'Click a piece to edit it, or a ring to build from there': 'לחיצה על חלק עורכת אותו, ועל טבעת ממשיכה לבנות ממנה',
  'Click anywhere to drop a ball from your hand': 'לחיצה בכל מקום מפילה כדור מהיד',
  'Join a yellow ring to a blue ring with a smooth track': 'מחבר טבעת צהובה לטבעת כחולה במסילה חלקה',
  'Click pieces to remove them': 'לחיצה על חלקים מוחקת אותם',
  'Where balls come from. Place it on any surface': 'מכאן יוצאים הכדורים. אפשר לשים על כל משטח',
  'A straight run': 'מסילה ישרה', 'Turn left': 'פונה שמאלה', 'Turn right': 'פונה ימינה', 'Spin down in circles': 'מסתובב למטה במעגלים',
  'A glass tube that falls straight down': 'צינור זכוכית שנופל ישר למטה', 'Ride through a dark tunnel': 'נסיעה דרך מנהרה חשוכה',
  'Needs speed! Build it low after a steep dive': 'צריך מהירות! בונים אותה נמוך אחרי צלילה תלולה',
  'Launches the ball into the air — aim with 🔮 Predict': 'מעיף את הכדור לאוויר — מכוונים עם 🔮 תחזית',
  'Sends balls left, right, left, right…': 'שולח כדורים שמאלה, ימינה, שמאלה, ימינה…',
  'Plays a tune as the ball rolls over it': 'מנגן מנגינה כשהכדור מתגלגל עליו',
  'Carries balls back up — build forever-loops': 'מעלה כדורים בחזרה למעלה — אפשר לבנות לולאה אינסופית',
  'Balls swirl round and round, then drop out below': 'הכדורים מסתחררים סביב ואז נופלים למטה',
  "The ball's weight turns the wheel": 'משקל הכדור מסובב את הגלגל',
  'Tips over when a ball rolls past the middle': 'נוטה כשהכדור עובר את האמצע',
  'Score a point when a ball lands in it': 'נקודה כשכדור נוחת בה', 'A big funnel that catches flying balls': 'משפך גדול שתופס כדורים מעופפים',
  'A soft basket — catches jumps': 'סל רך — תופס קפיצות', 'Boing! Bounces balls up and away': 'בוינג! מקפיץ כדורים למעלה',
  'Knock the first one and watch them all fall': 'מפילים את הראשון ורואים את כולם נופלים', 'Ding! Rings when a ball hits it': 'דינג! מצלצל כשכדור פוגע בו',
  'Kicks balls away like a pinball': 'בועט בכדורים כמו בפינבול',
  // options
  'cm': 'ס״מ', 'Length': 'אורך', 'Turn': 'כיוון', 'Angle': 'זווית', 'Radius': 'רדיוס', 'Turns': 'סיבובים', 'Size': 'גודל', 'Drop': 'נפילה', 'Kick': 'זינוק',
  'Spin': 'סיבוב', 'Height': 'גובה', 'Exit': 'יציאה', 'Rim': 'שפה', 'Tilt': 'הטיה', 'Count': 'כמות',
  '↰ Left': '↰ שמאלה', '↱ Right': '↱ ימינה', 'Tight': 'צפוף', 'Medium': 'בינוני', 'Wide': 'רחב', '⟲ Left': '⟲ שמאלה', '⟳ Right': '⟳ ימינה',
  'Back': 'אחורה', 'Left': 'שמאלה', 'Right': 'ימינה', 'Floor': 'רצפה',
  '◡ Open': '◡ פתוח', '◯ Glass': '◯ זכוכית', '🪵 Laser wood': '🪵 עץ לייזר', '🎢 Rails': '🎢 פסים',
  'Up': 'עלייה', 'Flat': 'מישור', 'Gentle': 'מתון', 'Steep': 'תלול', 'Dive': 'צלילה',
  'Next slope': 'שיפוע הבא', 'Color': 'צבע', 'Slope': 'שיפוע', 'Style': 'סגנון', 'Rainbow — a new color for every piece': 'קשת — צבע חדש לכל חלק',
  'Earth': 'כדור הארץ', 'Moon': 'ירח', 'Mars': 'מאדים', 'Jupiter': 'צדק', 'None': 'בלי', 'Normal': 'רגיל', 'Syrup': 'סירופ',
  'Super slow-mo': 'הילוך איטי במיוחד', 'Slow-mo': 'הילוך איטי', 'Half speed': 'חצי מהירות', 'Real time': 'זמן אמיתי', 'Fast': 'מהיר',
  // building hints & messages
  'First place a 📍 Start Tower, or click a yellow ring': 'קודם מניחים 📍 מגדל התחלה, או לוחצים על טבעת צהובה',
  'Click a surface to place the {0} · wheel = height · Q / E = turn': 'לחיצה על משטח מניחה {0} · גלגלת = גובה · Q / E = סיבוב',
  'Now click a blue ring to connect to': 'עכשיו לוחצים על טבעת כחולה', 'Click a yellow ring to start the connector': 'לוחצים על טבעת צהובה כדי להתחיל חיבור',
  'Click anywhere to drop a ball': 'לחיצה בכל מקום מפילה כדור', 'Click pieces to remove them · Esc when done': 'לחיצה על חלקים מוחקת · Esc לסיום',
  'First place a 📍 Start Tower': 'קודם מניחים 📍 מגדל התחלה', 'Locked in this challenge': 'נעול באתגר הזה',
  'Something is attached after it — remove that first': 'יש חלקים מחוברים אחריו — קודם מוחקים אותם',
  'Move: click a surface to drop it · Q / E turn · Esc cancel': 'הזזה: לחיצה על משטח מניחה · Q / E סיבוב · Esc ביטול',
  '🔒 Shape is locked because pieces are attached after it.': '🔒 הצורה נעולה כי מחוברים אחריו חלקים.',
  '✥ Move': '✥ הזזה', '↺ Stand up': '↺ להעמיד מחדש', '➕ Build from here': '➕ להמשיך מכאן', '🗑 Delete': '🗑 מחיקה',
  'Let go to add it here': 'משחררים כדי להוסיף כאן', 'Drop it on a ring': 'גוררים אל טבעת',
  'Click to place · height {0} cm (wheel) · Q / E turn · Alt = off grid': 'לחיצה מניחה · גובה {0} ס״מ (גלגלת) · Q / E סיבוב · Alt = בלי רשת',
  'Connected! 🔗': 'מחובר! 🔗', 'Next piece goes here': 'החלק הבא יבוא כאן', 'Now add pieces from the dock below ⬇': 'עכשיו מוסיפים חלקים מהמגש למטה ⬇',
  'Following ball #{0}': 'עוקבים אחרי כדור #{0}', '🎯 Goal! · {0}': '🎯 גול! · {0}', 'Gravity: {0}': 'כבידה: {0}', 'Next slope: {0}': 'שיפוע הבא: {0}',
  'Kid mode on: slow balls get a gentle push': 'מצב ילדים פעיל: כדורים איטיים מקבלים דחיפה עדינה', 'Kid mode off: pure physics': 'מצב ילדים כבוי: פיזיקה טהורה',
  'Fresh room! Place a 📍 Start Tower': 'חדר נקי! מניחים 📍 מגדל התחלה', 'Loaded! ✨': 'נטען! ✨', 'Could not read that file': 'לא הצלחתי לקרוא את הקובץ',
  'Demo coaster loaded — press ▶ Release!': 'רכבת ההדגמה נטענה — לוחצים ▶ שחרר!',
  'Nothing to replay yet — release a ball first': 'אין עדיין מה להציג — קודם משחררים כדור', 'Photo saved! 📸': 'התמונה נשמרה! 📸',
  'Too low — it would go through the floor': 'נמוך מדי — יעבור דרך הרצפה', 'Bumps into furniture': 'נתקע ברהיט', 'Overlaps another track': 'חופף למסילה אחרת', 'Too high!': 'גבוה מדי!',
  // prediction
  'Goal in {0} s': 'גול תוך {0} שנ׳', 'Falls off at {0} s': 'נופל מהמסלול אחרי {0} שנ׳', 'Falls off': 'נופל מהמסלול',
  'Stops on the track ({0} s)': 'נעצר על המסלול ({0} שנ׳)', 'Leaves the room!': 'יוצא מהחדר!', 'Runs forever (lift loop)': 'רץ לנצח (לולאת מעלית)',
  'Still rolling after {0} s': 'עדיין מתגלגל אחרי {0} שנ׳', 'Simulating… {0} s': 'מחשב… {0} שנ׳', 'Start {0}: ': 'מגדל {0}: ',
  'top {0} m/s · peak {1} g': 'שיא {0} מ׳/ש׳ · עד {1} g', 'Prediction is off — turn on 🔮 Predict.': 'התחזית כבויה — מדליקים 🔮 תחזית.',
  'Place a 📍 Start Tower and the 🔮 line will show where a ball goes.': 'מניחים 📍 מגדל התחלה והקו 🔮 יראה לאן הכדור ילך.',
  '🔴 The red ring shows where — click to look': '🔴 הטבעת האדומה מראה איפה — לחיצה מראה', 'Click to look there': 'לחיצה מראה את המקום',
  // balls
  'Glass Marble': 'גולת זכוכית', 'Wooden Ball': 'כדור עץ', 'Bouncy Ball': 'כדור קופץ', 'Hollow Plastic': 'כדור פלסטיק חלול', 'Clay Ball': 'כדור פלסטלינה',
  'Heavy, slick & fast. The classic.': 'כבדה, חלקה ומהירה. הקלאסיקה.', 'Light and grippy. Soft clacks.': 'קל ואוחז. נקישות רכות.',
  'Boing! Bounces off everything.': 'בוינג! קופץ מכל דבר.', 'Feather-light. Air drag & spin matter.': 'קל כנוצה. התנגדות האוויר והסיבוב משפיעים.',
  'Squishy. Zero bounce, lazy roller.': 'רך. בלי קפיצה, מתגלגל לאט.', 'g': 'גר׳', 'bounce': 'קפיציות', 'grip': 'אחיזה', 'hollow': 'חלול',
  // physics panel
  'No ball': 'אין כדור', 'Release a ball, then click it to see its speed, forces and energy.': 'משחררים כדור ולוחצים עליו כדי לראות מהירות, כוחות ואנרגיה.',
  'Riding the lift': 'במעלית', 'Flying!': 'עף!', 'Resting': 'נח', 'Sliding': 'מחליק', 'Rolling': 'מתגלגל',
  'm/s': 'מ׳/ש׳', 'g force': 'כוח g', 'cm high': 'ס״מ גובה', 'Track slope': 'שיפוע', 'Distance': 'מרחק', 'm': 'מ׳', 'Air time': 'זמן באוויר', 's': 'שנ׳',
  'Top speed': 'מהירות שיא', 'Max force': 'כוח שיא', 'motion': 'תנועה', 'spin': 'סיבוב', 'height': 'גובה', 'lost {0}%': 'אבד {0}%', 'speed': 'מהירות',
  'How is this calculated?': 'איך זה מחושב?', 'Rolling down a slope θ, part of the energy goes into spin, so:': 'בגלגול במדרון θ חלק מהאנרגיה הולך לסיבוב, ולכן:', 'Energy now:': 'אנרגיה עכשיו:',
  '🔮 Prediction': '🔮 תחזית', '📊 Physics': '📊 פיזיקה', '🧪 Physics lab': '🧪 מעבדת פיזיקה', 'Gravity': 'כבידה', 'Air': 'אוויר',
  'Force arrows': 'חיצי כוח', 'Trails': 'שובלים', '🧸 Kid mode': '🧸 מצב ילדים', 'Gives slow balls a gentle push so they never get stuck': 'נותן לכדורים איטיים דחיפה עדינה כדי שלא ייתקעו',
  // bars
  '✕ Back to build': '✕ חזרה לבנייה', 'Previous ball': 'הכדור הקודם', 'Next ball · Tab': 'הכדור הבא · Tab', '🎬 Replay': '🎬 שידור חוזר', '✕ Exit': '✕ יציאה',
  '📸 Snap': '📸 צלם', '✕ Done': '✕ סיום', 'Photo mode — frame your shot with the mouse': 'מצב צילום — מכוונים את התמונה עם העכבר',
  // menu & help
  '✨ Load the demo coaster': '✨ טעינת רכבת ההדגמה', '🧸 Empty room (start fresh)': '🧸 חדר ריק (מתחילים מחדש)', '🏆 Challenges': '🏆 אתגרים',
  '💾 Save to file': '💾 שמירה לקובץ', '📂 Open a file': '📂 פתיחת קובץ', 'Close': 'סגירה', 'How to play': 'איך משחקים',
  '1 · Build': '1 · בונים', '2 · Play': '2 · משחקים', '3 · Watch': '3 · צופים',
  'Pick <b>Start Tower</b> and click the floor, bed or desk. Then click or drag pieces from the dock. Each one snaps onto the glowing <b class="ring">ring</b>.':
    'בוחרים <b>מגדל התחלה</b> ולוחצים על הרצפה, המיטה או השולחן. אחר כך לוחצים או גוררים חלקים מהמגש. כל חלק נצמד ל<b class="ring">טבעת</b> הזוהרת.',
  'Press <b>Release</b> (or Space). The 🔮 line shows where a ball will go — a red ring marks where it would fall off.':
    'לוחצים <b>שחרר</b> (או רווח). הקו 🔮 מראה לאן הכדור ילך — טבעת אדומה מסמנת איפה הוא ייפול.',
  'Click a ball, then <b>Ride</b> inside it, or watch the <b>Movie</b> camera and <b>Replay</b>. Then try the 🏆 challenges!':
    'לוחצים על כדור ואז <b>נסיעה</b> בתוכו, או צופים במצלמת <b>סרט</b> וב<b>שידור חוזר</b>. ואז מנסים את 🏆 האתגרים!',
  'Controls & shortcuts': 'שליטה וקיצורים', 'orbit': 'סיבוב מצלמה', 'pan': 'הזזה', 'zoom': 'זום', 'move': 'תזוזה', 'straight / curves': 'ישר / פניות',
  'repeat last piece': 'חזרה על החלק האחרון', 'remove last': 'מחיקת האחרון', 'remove selected': 'מחיקת הנבחר', 'slope': 'שיפוע', 'turn while placing': 'סיבוב בזמן הנחה',
  'cameras': 'מצלמות', 'next ball': 'הכדור הבא', 'release': 'שחרור', 'pause': 'עצירה', 'info panel': 'לוח מידע', 'cancel': 'ביטול', 'replay': 'שידור חוזר',
  'photo': 'צילום', 'night': 'לילה', "Let's build! 🚀": 'יאללה לבנות! 🚀',
  // challenges
  'Pick a mission and earn up to 3 stars!': 'בוחרים משימה ומרוויחים עד 3 כוכבים!', 'Restart': 'מחדש', 'Exit': 'יציאה', 'Pieces used: {0}': 'חלקים בשימוש: {0}',
  'Perfect! ⭐⭐⭐': 'מושלם! ⭐⭐⭐', 'Challenge complete!': 'האתגר הושלם!', 'Can you get all 3 stars?': 'אפשר להשיג את כל 3 הכוכבים?',
  'Next challenge ▶': 'לאתגר הבא ▶', 'Keep improving': 'להמשיך לשפר',
  'First Goal': 'השער הראשון', 'Get a ball into a Goal Cup.': 'מכניסים כדור לכוס שער.', 'Score a goal': 'להבקיע', '10 pieces or fewer': 'עד 10 חלקים', '6 pieces or fewer': 'עד 6 חלקים',
  'Delivery to Bed': 'משלוח למיטה', 'Get a ball into the basket on the bed.': 'מכניסים כדור לסל שעל המיטה.', 'Basket!': 'לסל!', '12 pieces or fewer': 'עד 12 חלקים', '8 pieces or fewer': 'עד 8 חלקים',
  'Loop-the-Loop': 'לולאה מלאה', 'Send a ball upside-down through a loop, then score.': 'שולחים כדור הפוך דרך לולאה, ואז מבקיעים.', 'Through the loop and score': 'דרך הלולאה ולשער', 'Goal within 6 s': 'שער תוך 6 שניות',
  'Longest Ride': 'הנסיעה הארוכה', 'Make one ball ride as long as possible before it scores.': 'נסיעה ארוכה ככל האפשר לכדור אחד לפני שהוא מבקיע.',
  '10 s ride': 'נסיעה של 10 שנ׳', '20 s ride': 'נסיעה של 20 שנ׳', '30 s ride': 'נסיעה של 30 שנ׳', 'Best ride: {0} s': 'הנסיעה הכי ארוכה: {0} שנ׳',
  'Big Air': 'קפיצה גדולה', 'Launch a ball through the air and catch it in a goal.': 'מעיפים כדור באוויר ותופסים אותו בשער.',
  '0.3 s in the air': '0.3 שנ׳ באוויר', '0.5 s in the air': '0.5 שנ׳ באוויר', '0.7 s in the air': '0.7 שנ׳ באוויר', 'Best flight into a goal: {0} s': 'המעוף הכי ארוך לשער: {0} שנ׳',
  'Over the Teddy': 'מעל הדובי', 'Fly a ball right over the teddy bear on the bed.': 'מעיפים כדור ממש מעל הדובי שעל המיטה.', 'Fly over Teddy': 'לעוף מעל הדובי', 'Then score a goal': 'ואז להבקיע',
  'Domino Effect': 'אפקט הדומינו', 'Knock down every domino.': 'מפילים את כל אבני הדומינו.', 'All dominoes down': 'כל הדומינו נפלו',
  'Music Maker': 'מוזיקאי', 'Play as many xylophone notes as you can with ONE ball.': 'מנגנים כמה שיותר תווים בקסילופון עם כדור אחד.',
  '8 notes': '8 תווים', '16 notes': '16 תווים', '24 notes': '24 תווים', 'Most notes by one ball: {0}': 'הכי הרבה תווים לכדור אחד: {0}',
  'Forever Machine': 'מכונת נצח', 'Build a loop where one ball rides a lift again and again.': 'בונים לולאה שבה כדור אחד עולה במעלית שוב ושוב.',
  '2 lift rides': '2 נסיעות במעלית', '3 lift rides': '3 נסיעות במעלית', '5 lift rides': '5 נסיעות במעלית', 'Most lift rides by one ball: {0}': 'הכי הרבה נסיעות במעלית: {0}',
  'Moon Bounce': 'קפיצה על הירח', 'On the Moon, bounce a ball off a trampoline into a goal.': 'על הירח: מקפיצים כדור מטרמפולינה לשער.', 'Bounce into a goal': 'קפיצה לשער',
  // building as a chain
  '⤵ Insert after': '⤵ להכניס אחרי', 'the rest of the track moves along': 'שאר המסלול זז איתו',
  '⤵ Insert mode: pick a piece in the dock to slip it in · Esc to stop': '⤵ מצב הכנסה: בוחרים חלק במגש כדי להשחיל אותו · Esc לסיום',
  'Only pieces with an exit can go in the middle': 'רק חלק שיש לו יציאה יכול להיכנס באמצע',
  'Removed — the pieces after it stay where they are': 'הוסר — החלקים שאחריו נשארים במקום',
  'inserting': 'הכנסה', 'needs ≥ {0} m/s': 'צריך לפחות {0} מ׳/ש׳', 'ball ≈ {0} m/s': 'הכדור ≈ {0} מ׳/ש׳',
  // compact screen
  'Choose the ball': 'בחירת כדור', 'More': 'עוד', 'Prediction line': 'קו חיזוי', 'Night light': 'אור לילה', 'Sound': 'צלילים', 'Photo mode': 'מצב צילום',
  'Show the info panel · I': 'הצגת לוח המידע · I', 'Show the whole coaster · Z': 'להראות את כל המסלול · Z', 'Zoom in': 'התקרבות', 'Zoom out': 'התרחקות',
  'see everything': 'לראות הכול', 'place off the grid': 'הנחה בלי רשת', 'Info': 'מידע', 'Simulating…': 'מחשב…', 'Track style': 'סוג מסילה',
};
