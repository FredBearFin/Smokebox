/*
 * WHAT THIS FILE IS: The in-app Guide: plain-words help pages and printable quick cards (SB.guide) shown on their
 *   own screen at the address #/guide (or #/guide/page-name). The text comes from docs/sop/*.md.
 * PARTS: the page data (written by tools/build-guide.mjs), text and search helpers, drawing the screen, show, open, help link.
 * USES: 00-util.js (h, clear), 05-icons.js, 60-shell.js (router), 79-guide-art.js (pictures).
 * USED BY: 60-shell.js; menus and screens call SB.guide.open() and SB.guide.link(). Styles are in 24-guide.css.
 */
(function (g) {
  'use strict';
  const SB = (g.SB = g.SB || {});
  const doc = g.document || null;

  // The Guide pages: id, group (guide or cards), title, summary and blocks (h = heading, p = paragraph, ol, ul and
  // check = lists, fig = a picture from 79-guide-art.js). Inside the text, **double stars** mark the name of a
  // button or screen exactly as it appears in the app.
  // audit:data-start
  // guide:data-start (written by tools/build-guide.mjs from docs/sop; do not edit by hand)
  const PAGES = [
   {
    "id": "getting-started",
    "group": "guide",
    "title": "Getting started",
    "summary": "Add dishes, send a test order, take payment and save a backup. About ten minutes.",
    "blocks": [
     {
      "t": "h",
      "x": "1. Add your menu"
     },
     {
      "t": "ol",
      "x": [
       "A new Smokebox starts empty on purpose. Tap **Add my menu** on the welcome screen. To see a busy kitchen first, tap **Watch the demo**.",
       "Type what the dish is called and its price. As you type, a line shows how Smokebox reads it, like \"Reads as $12.50\". Tap where it is made. The starting stations are Kitchen, Prep, Fryer and Cold and drinks. Rename or drop any (see Setup recipes).",
       "Tap **Save and add another** until your menu is in. Then tap **Save and finish**."
      ]
     },
     {
      "t": "p",
      "x": "Change dishes and prices later: tap **Settings** (the three-line button at the top right of the board), then **Dishes and prices**. A dish you remove goes to **Removed dishes**. Tap **Bring it back** to put it back."
     },
     {
      "t": "p",
      "x": "The arrow buttons beside each dish change the order they appear in. The menu section list on a dish's row moves it to another menu section."
     },
     {
      "t": "p",
      "x": "Have your menu in a file? See Import or export your menu."
     },
     {
      "t": "h",
      "x": "2. Set your tax and hours"
     },
     {
      "t": "p",
      "x": "Tap **Settings**, then **Tax, hours and PIN**. Enter your sales tax (0 if you charge none) and your opening hours. A PIN is optional. It keeps the back office for managers only."
     },
     {
      "t": "p",
      "x": "Dishes and prices asks if you cook food ahead. See Cooked-ahead food and portions."
     },
     {
      "t": "h",
      "x": "3. Send a test order"
     },
     {
      "t": "ol",
      "x": [
       "Tap **New ticket**.",
       "Tap a dish, then tap **Send to kitchen**.",
       "The ticket appears on the board. Tap **Start**, then **Done** on the dish, then **Bump** the ticket."
      ]
     },
     {
      "t": "p",
      "x": "A test order counts in your reports. To remove it, cancel it (see Taking an order)."
     },
     {
      "t": "h",
      "x": "4. Take payment"
     },
     {
      "t": "p",
      "x": "Tap **Orders**. For cash, tap the Pay button on the order. It shows the total, like Pay $8.50 cash. For a card, a tip or a discount, tap **Tip or discount**, choose how it was paid, then tap **Mark paid**."
     },
     {
      "t": "p",
      "x": "Smokebox only writes down how the order was paid. It never charges a card."
     },
     {
      "t": "h",
      "x": "5. Save a backup"
     },
     {
      "t": "p",
      "x": "Tap **Back office**, then **Menu, prices and shop**. Find Data, backup and reset and tap **Download backup (JSON)**. This saves a file. Keep a copy off this device: email it to yourself or put it on a USB drive."
     }
    ]
   },
   {
    "id": "setup-recipes",
    "group": "guide",
    "title": "Setup recipes",
    "summary": "Four ways to set up Smokebox. Pick the one closest to your place. Each uses only what the app can do today. A station is a place in your kitchen, like the grill or the cold counter.",
    "blocks": [
     {
      "t": "h",
      "x": "Counter cafe or bakery"
     },
     {
      "t": "p",
      "x": "Every order makes a ticket. With Counter service on, a paid order's ticket clears itself."
     },
     {
      "t": "ul",
      "x": [
       "Stations: tap **Settings**, **Dishes and prices**, then **Change stations**. Rename one to \"Counter\" and tap **Not used** on the others.",
       "Settings: set tax and hours in **Tax, hours and PIN**. Answer **No** to cooking ahead. For a batch you bake, like 24 croissants, tap **I count what I made**. In **Settings**, **How you serve**, turn on **Counter service**.",
       "The board: one list of orders, no station tabs. Pay with **Cash** or **Card** as you send, and the ticket clears itself. With **Pay later**, tap **Bump** or pay from **Orders**."
      ]
     },
     {
      "t": "h",
      "x": "Food truck on one tablet"
     },
     {
      "t": "ul",
      "x": [
       "Stations: keep two, like \"Grill\" and \"Window\". Tap **Not used** on the rest.",
       "Settings: enter your tax. Set a PIN if others use the tablet. For How do you serve?, tap **Food truck / one person** to keep two order buttons, Walk-up and Pickup. Tap **Takeout** on each order. Tap **Cash** or **Card** before **Send to kitchen**.",
       "The board: tabs for All stations, your two stations and Expo. One tablet does both jobs. **New ticket** takes the order and All stations shows what to cook. **Orders** lists unpaid orders."
      ]
     },
     {
      "t": "h",
      "x": "Restaurant with a line and an expo"
     },
     {
      "t": "ul",
      "x": [
       "Stations: rename the starting stations (Kitchen, Prep, Fryer, Cold and drinks) to match your line. Expo stays.",
       "Settings: choose **Dine-in** and a table on each order. Set a PIN to keep cooks out of the back office.",
       "The board: a station gets a tab once a dish is made there. Each cook opens their tab and sees only their dishes. Expo is the person who checks and packs whole orders. Expo sees whole tickets, each dish tagged with its station, and taps **Bump** when the plate is complete."
      ]
     },
     {
      "t": "h",
      "x": "Kitchen that cooks food ahead"
     },
     {
      "t": "ul",
      "x": [
       "Stations: as above.",
       "Settings: in **Dishes and prices**, tap **Yes, I cook ahead**. Add each pot or tray as a cooked-ahead item, Hot or Cold, with the time limit your health department gives you.",
       "The board: a **Cabinet** tab appears. Tap **New batch** and **Log temp** at every check. See Cabinet and warnings."
      ]
     }
    ]
   },
   {
    "id": "how-you-serve",
    "group": "guide",
    "title": "How you serve",
    "summary": "Counter or table, kitchen tickets or none, your own order buttons and your own currency symbol.",
    "blocks": [
     {
      "t": "h",
      "x": "Open it"
     },
     {
      "t": "p",
      "x": "Tap **Settings**, then **How you serve**. Every change saves at once, and a bar offers **Undo**. Under your dishes you may also see the question \"How do you serve?\". Its answers only set the options below."
     },
     {
      "t": "h",
      "x": "Counter service"
     },
     {
      "t": "p",
      "x": "The switch says On or Off beside its name. Turn on **Counter service** if you hand food over at the counter. The board shows one list of orders, with no station tabs, no Start step and no late colors. When an order is paid, its tickets finish and clear themselves. With **Pay later**, the ticket waits until you pay from **Orders** or tap **Bump**. Leave it off if cooks work from tickets."
     },
     {
      "t": "h",
      "x": "Order buttons"
     },
     {
      "t": "p",
      "x": "These are the quick buttons on the order screen, like Walk-up, Pickup and tables. The ones in use show as buttons: tap one to remove it. Type a name and tap **Add button** to add one (up to 12), or tap **Use the starting list** to start again. With none, the order screen shows only the name box."
     },
     {
      "t": "h",
      "x": "Currency symbol"
     },
     {
      "t": "p",
      "x": "Pick $, € or £, or **Your own**: one to three characters, like kr. It shows with every price, and open screens update when you close the sheet. It does not convert anything."
     },
     {
      "t": "h",
      "x": "An order you did not finish"
     },
     {
      "t": "p",
      "x": "If the page closes or reloads in the middle of an order, tap **New ticket**. Your dishes come back with the note \"Restored your unfinished order\". Tap **Clear order** to start fresh."
     }
    ]
   },
   {
    "id": "import-a-menu",
    "group": "guide",
    "title": "Import or export your menu",
    "summary": "Bring dishes in from a spreadsheet or a point-of-sale export, instead of typing each one.",
    "blocks": [
     {
      "t": "h",
      "x": "Open it"
     },
     {
      "t": "p",
      "x": "Tap **Settings**, **Dishes and prices**, **More ways to add dishes**, then **Have a menu file? Import it**. Tap **Choose a menu file** or paste a list, then tap **Preview**. Nothing is added yet."
     },
     {
      "t": "h",
      "x": "Read the preview"
     },
     {
      "t": "p",
      "x": "Smokebox says what kind of file it thinks this is, such as a spreadsheet or a Lightspeed items export. Square, Toast and Clover exports work the same way. Each row shows its dish, its price and \"Read as $14.00\", the price it understood. Fix a name or price in the row, or clear the box to leave a dish out. A row with a problem says what is wrong and starts cleared."
     },
     {
      "t": "ul",
      "x": [
       "Prices may be in cents. If every price is a large whole number, Smokebox asks. Tap **These prices are in cents**, or **These prices are in dollars** to undo it.",
       "Columns it does not use are listed, like \"Ignored column: Calories\". Notes and descriptions are not kept. Only the name, price, station and section are.",
       "Pick one station for every dish in **Put all these dishes at**, and one section in **Put all these dishes in**.",
       "New sections in the file? Tap **Add these sections**."
      ]
     },
     {
      "t": "h",
      "x": "Add them"
     },
     {
      "t": "p",
      "x": "Tap **Import** with the number shown, like Import 12 dishes. Changed your mind? Tap **Remove these** and the whole import comes off the menu."
     },
     {
      "t": "p",
      "x": "Adding dishes by hand in Dishes and prices works just as well."
     },
     {
      "t": "h",
      "x": "Export your menu"
     },
     {
      "t": "p",
      "x": "Tap **Export my menu** on the same screen. It saves your dishes as a spreadsheet file, smokebox-menu.csv, that you can edit and import again."
     }
    ]
   },
   {
    "id": "taking-an-order",
    "group": "guide",
    "title": "Taking an order",
    "summary": "Start an order, add dishes and notes, send it to the kitchen, and add to it later.",
    "blocks": [
     {
      "t": "h",
      "x": "Start the order"
     },
     {
      "t": "p",
      "x": "Tap **New ticket**. Tap a dish to add it. Tap it again to add one more. A dish marked 86 (sold out) cannot be added."
     },
     {
      "t": "h",
      "x": "Customer and order type"
     },
     {
      "t": "p",
      "x": "Under **New or open order**, keep **New order**. Under **Customer**, type a name in the **Customer name** box or tap a quick name. Leave it blank for Walk-up. Choose how the order came in: Dine-in, Takeout, Drive-thru or Delivery app. Each type has its own time limit before a ticket turns amber and then red."
     },
     {
      "t": "h",
      "x": "Allergies and notes"
     },
     {
      "t": "p",
      "x": "Under Any food allergy?, tap **Allergy**, then tap what the customer is allergic to. Put allergies first in the note. Cooks read the first line first."
     },
     {
      "t": "h",
      "x": "Rush"
     },
     {
      "t": "p",
      "x": "Switch on **Rush ticket** when a customer is waiting. Every dish starts at once and the ticket goes to the front of the board."
     },
     {
      "t": "h",
      "x": "Send it"
     },
     {
      "t": "p",
      "x": "Tap **Send to kitchen**. Each station sees only its own dishes. Pay now, or leave it on Pay later and take payment from **Orders** when the customer is ready."
     },
     {
      "t": "h",
      "x": "Add to an order that is still open"
     },
     {
      "t": "p",
      "x": "Tap **New ticket** again and choose **Add to open order**. The new ticket is added to the same order."
     },
     {
      "t": "h",
      "x": "Fixing a mistake"
     },
     {
      "t": "ul",
      "x": [
       "**Undo** appears for 10 seconds after an action. After that, fix it by hand.",
       "To cancel a ticket, open its small menu on the board, tap **Void ticket** and say why. A cancelled ticket is left out of your sales and money, and shows only in the count of voided tickets."
      ]
     }
    ]
   },
   {
    "id": "running-the-line",
    "group": "guide",
    "title": "Running the line",
    "summary": "What a cook does on the kitchen board.",
    "blocks": [
     {
      "t": "h",
      "x": "Read a ticket"
     },
     {
      "t": "fig",
      "id": "ticket",
      "alt": "A ticket on the kitchen board with seven numbered parts: ticket number and clock, customer, next step, a dish row, Start or Done, the more menu, and Bump.",
      "cap": "A ticket on the board. The numbers match the list below."
     },
     {
      "t": "ol",
      "x": [
       "Ticket number and clock. The clock counts up from when the order came in. It turns amber, then red, when the order is taking too long.",
       "The customer, the order type and how many dishes are done.",
       "The next step. This line says what to do next.",
       "A dish. It shows its station, and a countdown once it is cooking.",
       "**Start** or **Done** for that dish. Quick dishes, like drinks, only need Done.",
       "The small menu (the ... button): cancel the ticket or mark it as a rush.",
       "**Bump** finishes the ticket and takes it off the board, once every dish is done."
      ]
     },
     {
      "t": "h",
      "x": "Start and finish dishes"
     },
     {
      "t": "ol",
      "x": [
       "Tap **Start** when you begin a dish that takes time. A countdown shows the usual cooking time.",
       "When the countdown reaches zero the row says Check it. Look at the food. Smokebox never decides that a dish is done.",
       "Tap **Done** when the dish is really finished."
      ]
     },
     {
      "t": "p",
      "x": "Gray dishes are waiting on purpose, so the whole order finishes together. Tap **Start now** to start one early."
     },
     {
      "t": "h",
      "x": "Send the ticket out"
     },
     {
      "t": "p",
      "x": "To bump a ticket is kitchen talk for sending it off the board. Smokebox keeps that word."
     },
     {
      "t": "p",
      "x": "If a dish is not done, Bump asks first. Bumped by mistake? **Undo** brings it back for 10 seconds. After that, use **Recall**."
     },
     {
      "t": "h",
      "x": "When something runs out"
     },
     {
      "t": "p",
      "x": "Tap **Sold out** at the top (the 86 board), find the dish and mark it sold out. Smokebox also does this by itself when a dish's food runs low."
     },
     {
      "t": "h",
      "x": "Full screen and the front counter"
     },
     {
      "t": "p",
      "x": "On a tablet, tap **Full screen** at the bottom right to hide the browser's bars. **Front counter** at the top opens the order page on the whole screen; its **Board** link brings you back here."
     }
    ]
   },
   {
    "id": "cooked-ahead-and-portions",
    "group": "guide",
    "title": "Cooked-ahead food and portions",
    "summary": "Two ways to keep track of food you make before the order comes in. Skip this page if you cook everything to order.",
    "blocks": [
     {
      "t": "h",
      "x": "Count portions"
     },
     {
      "t": "p",
      "x": "Use this for a dish you make a batch of and sell until it is gone, like 20 sandwiches."
     },
     {
      "t": "ol",
      "x": [
       "Tap **Settings**, then **Dishes and prices**. Under the dish, tap **I count what I made**.",
       "Type how many you made and tap **Start counting**.",
       "The dish shows how many are left, like \"20 left\". Tap **+10** or **Add** when you make more.",
       "At zero the dish shows as sold out. **Stop counting** turns it off."
      ]
     },
     {
      "t": "p",
      "x": "Counting does not track temperature or time."
     },
     {
      "t": "h",
      "x": "Track food you hold hot or cold"
     },
     {
      "t": "p",
      "x": "Use this for food kept in a warmer or cooler, like chili or potato salad, so Smokebox can warn you before it runs out of time."
     },
     {
      "t": "ol",
      "x": [
       "In **Dishes and prices**, find \"Do you cook food ahead?\" and tap **Yes, I cook ahead**. The cooked-ahead sheet opens.",
       "Type what you cook ahead and choose Hot or Cold.",
       "Set how long it may stay. Hot food takes one number of hours. Cold food has two optional boxes: days in the fridge, and hours out of the fridge. Use the limits your local health department gives you. Leave a box empty if none is set, and Smokebox will only show the time. See Cold items in the fridge.",
       "Select the dishes that use it, and type the grams of it in one serving for each. Smokebox takes that much off the batch for each dish made.",
       "Tap **Save cooked-ahead item**. Then tap **Log a first batch**, or **Done for now**. To change an item later, open it from the list and tap **Save changes**."
      ]
     },
     {
      "t": "p",
      "x": "The question \"Do you cook food ahead?\" has three answers. Choose **No** if you cook everything to order. **Not sure** counts as No for now. You can turn it on later in **Settings**, then **Tax, hours and PIN**."
     }
    ]
   },
   {
    "id": "hold-cabinet-and-warnings",
    "group": "guide",
    "title": "Cabinet and warnings",
    "summary": "For kitchens that cook food ahead, like pots of soup or trays of rice. Skip this page if you cook everything to order.",
    "blocks": [
     {
      "t": "h",
      "x": "Food in the cabinet"
     },
     {
      "t": "fig",
      "id": "cabinet",
      "alt": "Steps for a batch in the hold cabinet: it goes in, it is checked, portions are pulled out, and it ends by being reheated or thrown out.",
      "cap": "A batch in the hold cabinet."
     },
     {
      "t": "p",
      "x": "No **Cabinet** tab? Say yes to cooking ahead first (see Cooked-ahead food and portions)."
     },
     {
      "t": "ol",
      "x": [
       "Open the **Cabinet** tab. Tap **New batch**, choose the food, and enter the weight and a first temperature reading. Tap **Put in hold cabinet**.",
       "Each batch has a card with two main buttons. **Pull** takes out the usual amount, like Pull 4.50 kg, as food leaves the cabinet. **Log temp** writes down a temperature reading. Take one at every check. A reading in range keeps the batch on the menu.",
       "The button can change. A batch too cool for under 2 hours becomes **Reheat**; later, it must be thrown out. One reheat per batch is Smokebox's own rule. When a batch is past its quality limit it becomes **Keep serving**: check the food, then decide.",
       "The **More for this batch** button (...) opens **Pull**, **Start cooling** and **Discard**, and **Remind me in 10 min** while a warning is showing. Tap **Discard** and pick a reason when a batch is out of time or range."
      ]
     },
     {
      "t": "h",
      "x": "Warnings before the time runs out"
     },
     {
      "t": "fig",
      "id": "ladder",
      "alt": "Four warning steps as a batch nears its time limit: a soft chime about an hour before, a voice call at thirty minutes, a loud repeating tone at ten minutes, and a different sound when time is up. A note says warnings only sound while the screen is on and Smokebox is open.",
      "cap": "The warning steps. Times shown are the usual ones."
     },
     {
      "t": "ol",
      "x": [
       "About an hour left: a soft chime, and a row appears in the strip at the top.",
       "30 minutes left: a voice call.",
       "10 minutes left: a loud tone and voice. It repeats every 20 seconds until you tap the strip row.",
       "Time is up: a different sound, and the batch comes off the menu."
      ]
     },
     {
      "t": "p",
      "x": "Some foods warn earlier. Change the times in Menu, prices and shop, **Batch expiry warnings only**. A nearly empty batch stays quiet."
     },
     {
      "t": "p",
      "x": "Warnings sound only while the screen is on and Smokebox is open on the board, with the volume up, inside your opening hours."
     }
    ]
   },
   {
    "id": "cold-items-in-the-fridge",
    "group": "guide",
    "title": "Cold items in the fridge",
    "summary": "For cold food you keep in a fridge, like potato salad or a tray of dessert. Skip this page if you do not cook ahead.",
    "blocks": [
     {
      "t": "h",
      "x": "Set it up"
     },
     {
      "t": "p",
      "x": "In **Dishes and prices**, add the item and choose Cold. Two optional boxes appear: how many days it may stay in the fridge, and how many hours it may be out of the fridge. Use the limits your local health department gives you. Leave a box empty and Smokebox keeps the time but says \"No limit set\". The limits are copied onto each batch when you make it."
     },
     {
      "t": "h",
      "x": "Each batch"
     },
     {
      "t": "p",
      "x": "Open the **Cabinet** tab and tap **New batch**. The card says \"In the fridge since\", shows the day it was made, and shows \"Use by\" with your number of days. The day it was made counts as day 1."
     },
     {
      "t": "h",
      "x": "Take out and Put back"
     },
     {
      "t": "p",
      "x": "Tap **Take out** when the food leaves the fridge for the line. The card says \"Out of the fridge since\" and the out-of-fridge clock runs. Tap **Put back** and the clock pauses. It adds up every time the food is out, and the card compares it with your hours, like \"out of your 2 h limit\". You are asked for your initials once, and an **Undo** bar follows each tap."
     },
     {
      "t": "h",
      "x": "The limits are yours"
     },
     {
      "t": "p",
      "x": "The days and hours are the numbers you typed. Smokebox does not know your local rules and does not say what they are. It only counts the time against your limits."
     }
    ]
   },
   {
    "id": "readings",
    "group": "guide",
    "title": "Readings",
    "summary": "Write down fridge, thermometer and sanitizer strip readings in one place. You see Readings only if you cook food ahead.",
    "blocks": [
     {
      "t": "h",
      "x": "Open it"
     },
     {
      "t": "p",
      "x": "Tap **Settings**, then **Readings**."
     },
     {
      "t": "h",
      "x": "Three things you can write down"
     },
     {
      "t": "ul",
      "x": [
       "**Fridge, freezer or display case**: pick which one, add a name if you like (like Walk-in), type the temperature, and tap **Log reading**.",
       "**Food thermometer check**: type what the thermometer says, say how you checked it (Ice water, Boiling water or Other), and tap **Log check**.",
       "**Sanitizer strip**: type the strip reading in parts per million. Add the sanitizer and where if you like. Tap **Log strip reading**. This also marks surfaces as sanitized."
      ]
     },
     {
      "t": "p",
      "x": "Each entry goes in the safety record with your initials. Type the number the thermometer or strip really shows before you tap the log button."
     },
     {
      "t": "h",
      "x": "What it does not do"
     },
     {
      "t": "p",
      "x": "Smokebox writes down what you type. It does not know what a good reading is and cannot see the food. Use the numbers your health department and the sanitizer's label give you."
     },
     {
      "t": "h",
      "x": "Fix a wrong entry"
     },
     {
      "t": "p",
      "x": "Open the entry in **Recent readings** and tap **Save fix**. The old entry stays, with your fix next to it."
     },
     {
      "t": "h",
      "x": "The safety record"
     },
     {
      "t": "p",
      "x": "In **Back office**, open **Safety** and tap **Print the safety record**. It lists thrown-out batches, your readings and checks, and changes to limits, like \"Changed the cold limit from X to Y\". A cold reading says \"above the cold limit\" and how many minutes above it the batch has already used. The record says how long Smokebox keeps entries; ask your health department how long you must."
     }
    ]
   },
   {
    "id": "closing-the-day",
    "group": "guide",
    "title": "Closing the day",
    "summary": "Close the day when the last order is paid. It saves the day's totals and gives you a page to print.",
    "blocks": [
     {
      "t": "h",
      "x": "Close the day"
     },
     {
      "t": "ol",
      "x": [
       "Tap **Orders**, then **Close the day** at the bottom.",
       "If an order is still open, it is listed. Every order must be paid or cancelled first. Tap **Open Orders to pay or void**, then come back.",
       "If you cook ahead and food is left in the cabinet, choose **Keep it** (the timers keep running) or **Throw it all out** (logged as other).",
       "Read Money today: cash, card and other. If you like, type **Cash you started the day with**. Smokebox remembers it on this device and adds today's cash payments, and tips paid in cash, to say how much should be in the drawer. It is a helper for counting.",
       "Tap **Close the day**.",
       "Tap **Back up today's data now** and **Print today's summary**."
      ]
     },
     {
      "t": "p",
      "x": "Closing does not lock new orders, and closing again later includes them. A paid order from a day you already closed cannot be opened again. The app's day turns over at 4 am."
     },
     {
      "t": "h",
      "x": "Also"
     },
     {
      "t": "ul",
      "x": [
       "Wipe down food-contact surfaces and tap **Sanitize** if you cook ahead.",
       "If your health department asks, save or print the thrown-out log. Open it from the **Settings** button on the board.",
       "Keep a copy of the backup off this device (see Backup and restore).",
       "Which weekday sells best? In **Back office**, open **Sales and money** and look at **Best day of the week**.",
       "For your accountant: in **Menu, prices and shop**, under Spreadsheet files, tap **Sales by day (for your accountant)**. It saves one row for each day: sales, tax, tips and cash, card and other."
      ]
     }
    ]
   },
   {
    "id": "who-made-this-entry",
    "group": "guide",
    "title": "Who made this entry",
    "summary": "Initials go next to temperature readings and thrown-out batches, so the log shows who did what. A wrong entry is corrected, not erased.",
    "blocks": [
     {
      "t": "h",
      "x": "Initials"
     },
     {
      "t": "ol",
      "x": [
       "The first time you log a temperature or throw a batch out on a tablet, Smokebox asks \"Who is this?\". Type your initials. **Skip** is allowed, and the action still goes ahead.",
       "The tablet remembers them while you keep working, and asks again after two idle hours.",
       "When someone else takes over, tap **Switch person** in the cabinet."
      ]
     },
     {
      "t": "h",
      "x": "Fix an entry"
     },
     {
      "t": "ol",
      "x": [
       "Open the thrown-out log from the board's menu. It starts by saying how far back it goes, like \"Showing every batch thrown out since\" a date.",
       "Tap **Fix this entry** on the row.",
       "Say what was wrong, add your initials and tap **Save the fix**."
      ]
     },
     {
      "t": "p",
      "x": "The old entry stays in the log. Your fix is saved as a new entry next to it, with your initials and the time. That keeps the record honest."
     }
    ]
   },
   {
    "id": "backup-and-restore",
    "group": "guide",
    "title": "Backup and restore",
    "summary": "Everything Smokebox knows is saved in this browser on this device. A backup is a file you keep somewhere else.",
    "blocks": [
     {
      "t": "h",
      "x": "Make a backup"
     },
     {
      "t": "ol",
      "x": [
       "Tap **Back office**, then **Menu, prices and shop**.",
       "Find Data, backup and reset. In the first card, **Back up now**, tap **Download backup (JSON)**. Or tap **Copy backup** and paste the text into an email to yourself.",
       "Keep a copy off this device."
      ]
     },
     {
      "t": "p",
      "x": "Back up every day at close. A copy kept only on this device is lost with it."
     },
     {
      "t": "h",
      "x": "Restore from a backup"
     },
     {
      "t": "ol",
      "x": [
       "In the second card, **Restore from a backup**, tap **Choose a backup file**. Pick the newest one, named smokebox-backup-(date).json. Or paste the text and tap **Check pasted backup**.",
       "Read the summary: the date, tickets and batches should match what you expect. Nothing has changed yet.",
       "If it is right, tap **Replace everything with this backup**. This replaces all data on this device, including the PIN and your station names. Back up what is here first if you might want it.",
       "Open the board and check your menu and your food. Sound and loudness are set per device, so test them again."
      ]
     },
     {
      "t": "p",
      "x": "After a restore the Data page says \"Your kitchen before this restore is kept for\" some days, with **Undo this restore**. Tap it, then **Put my old kitchen back** (or **Keep what I have**), and enter the PIN if one is set. If the browser was short on room, the copy keeps only recent tickets, or the restore says none could be kept."
     },
     {
      "t": "p",
      "x": "The look, text size, sound and starting cash stay on each device and are not in a backup."
     },
     {
      "t": "p",
      "x": "A file that is not a valid backup, a backup from the demo, or a spreadsheet file is refused, and nothing changes."
     },
     {
      "t": "h",
      "x": "Start over"
     },
     {
      "t": "p",
      "x": "To empty your kitchen and begin again with a blank menu, see Start over with an empty menu."
     },
     {
      "t": "h",
      "x": "Erasing"
     },
     {
      "t": "p",
      "x": "The Danger zone has **Erase tickets and records** and **Erase everything**. Each asks you to type a word first. Back up before using either. With a PIN set, these and **Replace everything with this backup** ask for the PIN first."
     },
     {
      "t": "h",
      "x": "How full the saved history is"
     },
     {
      "t": "p",
      "x": "Settings and the Data page show **Saved history**, how full this tablet is. When it is nearly full, **Close the month...** is offered there."
     }
    ]
   },
   {
    "id": "close-the-month",
    "group": "guide",
    "title": "Close the month",
    "summary": "Move old, finished history out of this device so it stays quick. You save everything to files first. Nothing is removed until step 3.",
    "blocks": [
     {
      "t": "p",
      "x": "The screen is called **Close the month**. If a PIN is set, the PIN pad opens first."
     },
     {
      "t": "ol",
      "x": [
       "**What this does**. Under **Close everything before**, the date starts on the first of this month. Smokebox shows what moves out (days, orders, tickets and activity records) and what stays: the last 35 days, today, every open order and open ticket, your menu and settings, the end-of-day totals, and all food-safety records. If you pick a date inside the last 35 days, it tells you where it stops instead. Tap **Next: save the files**.",
       "**Save the month files now**. Tap **Save the month files now**. Your browser downloads five files: a backup of the whole kitchen, three spreadsheets (orders, tickets and days) and a list of what is in them. Look in your downloads folder and check each one is there. If the browser asks to allow several downloads, say yes. Select **I saved the files and I can find them**, then tap **Next: confirm**.",
       "Type CLOSE. Type the word CLOSE, in any case. Then the red **Close the month** button works."
      ]
     },
     {
      "t": "p",
      "x": "After step 3 the history leaves this device. For 7 days you can still undo it here; after that, the files you saved in step 2 are the only copy. The last screen says \"Done. The month is closed.\" and has **Undo**, which says \"Undone. Your kitchen is back as it was, with all the history.\" Tap **Done** to leave."
     },
     {
      "t": "p",
      "x": "To bring everything back later: Back office, Data, Restore, and pick the backup file."
     },
     {
      "t": "h",
      "x": "When it refuses"
     },
     {
      "t": "p",
      "x": "Each refusal ends with \"Nothing was removed.\""
     },
     {
      "t": "ul",
      "x": [
       "Something changed since you saved the files (a new day started or a record changed): save the files again in step 2, then close. A page reload does the same.",
       "On a device that works through the main computer, it cannot be closed there. Do it on the main computer's own screen or the main tablet.",
       "In the demo there is no real history. Tap **Back to my kitchen** first.",
       "With nothing old enough to close, the screen says \"There is nothing to close yet.\" and shows no next step.",
       "If the browser would not save the change, nothing was removed."
      ]
     }
    ]
   },
   {
    "id": "start-over",
    "group": "guide",
    "title": "Start over with an empty menu",
    "summary": "Empty your kitchen and begin again with a blank menu. When there are orders or tickets, a backup file is saved first.",
    "blocks": [
     {
      "t": "h",
      "x": "Only dishes so far"
     },
     {
      "t": "p",
      "x": "No tickets, orders or sales yet? Then nothing real can be lost. The screen says so and has one button: tap **Start over now**. No backup and no typed word are needed. **Save a copy of the old menu** on the last screen is there if you want it."
     },
     {
      "t": "h",
      "x": "With orders or tickets"
     },
     {
      "t": "ol",
      "x": [
       "Tap **Settings**. At the bottom, tap **Start over with an empty menu**. If a PIN is set, the PIN pad opens first.",
       "Read what goes and what stays. Clear **Keep my tax, hours, PIN and station names** to reset those too. Tap **Next: about your backup**.",
       "Tap **Save my backup file now**. The file downloads before anything is erased. Look in your downloads folder, select **I saved the backup file and I can find it**, then tap **Next: confirm**.",
       "Type ERASE, then tap **Erase everything and start over**.",
       "At \"Done. Your kitchen is empty.\" tap **Save the backup again** or **Go to the first screen**."
      ]
     },
     {
      "t": "p",
      "x": "This cannot be undone. Save a backup first: to go back, restore the backup file. Left-over old demo tickets get **Clear them** or **Keep them**."
     },
     {
      "t": "p",
      "x": "With a PIN set, the PIN pad opens first. If the backup cannot be saved, nothing is erased."
     }
    ]
   },
   {
    "id": "replacing-a-device",
    "group": "guide",
    "title": "Replacing a device",
    "summary": "Move Smokebox to a new tablet or computer and keep your menu, settings and history. The Data page has a card, **Replacing this device**, with the same steps.",
    "blocks": [
     {
      "t": "ol",
      "x": [
       "On the old device, if it still works, download a backup (see Backup and restore). Copy the file somewhere else: email it to yourself or use a USB drive.",
       "On the new device, copy the same smokebox.html file onto it and open it. Install it as an app: on an iPad tap Share, then Add to Home Screen. In Chrome tap the menu, then Install app.",
       "Tap **Settings**, then **Device checks: screen, sound, home screen**. Sound and keeping the screen on are set on each device, so do them again here.",
       "Tap **Back office**, then **Menu, prices and shop**. In the **Restore from a backup** card, choose the backup file, check the summary and tap **Replace everything with this backup**.",
       "Check the board and your menu. Save a fresh backup from the new device, then retire the old one."
      ]
     },
     {
      "t": "p",
      "x": "If the old device is broken and you have no backup file, its data cannot be recovered. This is why a daily backup matters."
     },
     {
      "t": "p",
      "x": "Separate devices do not share data yet. Two tabs on the same device stay in step."
     }
    ]
   },
   {
    "id": "get-the-tablet-ready",
    "group": "guide",
    "title": "Get the tablet ready",
    "summary": "Five quick checks so the board keeps working during service.",
    "blocks": [
     {
      "t": "h",
      "x": "Open it"
     },
     {
      "t": "p",
      "x": "Tap **Settings**, then **Device checks: screen, sound, home screen**. Each check shows a check mark, or a plain line saying what to do. A check mark means you or the device confirmed it. It is not a promise it stays that way all day. For the longer first-time list, open **Set up this device: first steps**. It has two help links at the top: **Help with setup** and **No sound?**."
     },
     {
      "t": "h",
      "x": "The five checks"
     },
     {
      "t": "ul",
      "x": [
       "**Screen stays awake**: warnings cannot sound while the screen is off. Smokebox asks the browser to keep it on, but also set the tablet to never sleep and keep it plugged in. Tap **Check again** after you change it.",
       "**Sound is on** and **Volume is loud enough**: tap **Test the sound**. Tap **Yes, I heard it**, or turn the volume up and try again. A tablet speaker is easy to miss in a loud kitchen. A small Bluetooth speaker near the cutting board helps.",
       "**Added to the home screen**: open Smokebox from its icon, not from the browser.",
       "**Full screen**: tap **Go full screen**, or install the app so it opens without the browser bars."
      ]
     },
     {
      "t": "h",
      "x": "Two lines you may see on the board"
     },
     {
      "t": "ul",
      "x": [
       "\"This screen may go to sleep, and warnings stop while it sleeps.\" Keep the tablet plugged in with its screen set to stay on.",
       "\"Warnings are silent: sound is off on this tablet. Tap to turn on.\" Tap it once."
      ]
     }
    ]
   },
   {
    "id": "troubleshooting",
    "group": "guide",
    "title": "Troubleshooting",
    "summary": "Plain fixes for sound, sleep, missing dishes and odd numbers. Lost data and the PIN are on the next page.",
    "blocks": [
     {
      "t": "h",
      "x": "No sound"
     },
     {
      "t": "ol",
      "x": [
       "If the board says \"Tap to turn on sound\", tap it. Browsers need one tap first.",
       "Turn the tablet volume up and check its silent switch.",
       "Tap **Settings** and check that Sound is on and the loudness is not low.",
       "Tap **Settings**, then **Device checks: screen, sound, home screen**, then **Test the sound**.",
       "If the bar says \"Sound paused\", it is outside your opening hours. Set the hours under **Tax, hours and PIN**.",
       "Close any second Smokebox tab. Only the tab on screen makes sound."
      ]
     },
     {
      "t": "h",
      "x": "The screen went to sleep"
     },
     {
      "t": "p",
      "x": "Warnings cannot sound while the screen is off. Smokebox asks the browser to keep the screen on, but some browsers say no. Set the tablet to never sleep (Auto-Lock on an iPad, Screen timeout on Android) and keep it plugged in. **Device checks: screen, sound, home screen** checks this. When you wake it, check the times on the cards."
     },
     {
      "t": "h",
      "x": "A dish is missing"
     },
     {
      "t": "ul",
      "x": [
       "Clear the search box and choose All on the New ticket screen.",
       "Open the **86 board**. A dish that is sold out or off the menu is listed there with the reason.",
       "Open **Dishes and prices** to see every dish you have added. A dish you removed is under **Removed dishes**: tap **Bring it back**.",
       "No **Cabinet** tab or **Sanitize** button? They show only after you say **Yes, I cook ahead** in **Dishes and prices**."
      ]
     },
     {
      "t": "h",
      "x": "A number looks wrong"
     },
     {
      "t": "ul",
      "x": [
       "A strip says the tablet's clock jumped ahead? Smokebox keeps the old time, so tickets and timers keep running. Tap **Keep the old time** to hide it for 10 minutes and fix the clock in the device settings. Tap **Use the new time** only if the new time is right. It asks once more before anything changes.",
       "Check the date range and the filters at the top of the Back office page.",
       "If sample days are switched on, choose **Your tickets only** to leave them out: sample days are made up.",
       "Unpaid orders are not counted as money collected.",
       "Starter estimates (prep times, yields, costs) are guesses until you confirm them."
      ]
     }
    ]
   },
   {
    "id": "empty-lost-or-locked",
    "group": "guide",
    "title": "Empty, lost or locked",
    "summary": "What to do when Smokebox opens empty, your data is gone, or you cannot get past the PIN.",
    "blocks": [
     {
      "t": "h",
      "x": "I closed the tab"
     },
     {
      "t": "p",
      "x": "Smokebox saves every change as you go. Open it again in the same browser and the board comes back. The clocks kept running, and no warning sounded while it was closed."
     },
     {
      "t": "h",
      "x": "The tablet was replaced or cleared"
     },
     {
      "t": "p",
      "x": "Your data lives only in the browser on one device. Clearing the browser data, or using another browser or a private window, shows an empty Smokebox. Restore your last backup (see Backup and restore)."
     },
     {
      "t": "h",
      "x": "I forgot the PIN"
     },
     {
      "t": "p",
      "x": "When you set a PIN, a recovery code shows once. Tap **Copy** or **Print**, keep it away from the tablet, select **I saved it**, then tap **Done**. On the PIN pad, open **Forgot the PIN?**, type the recovery code and a new PIN (or leave it empty to remove the PIN), and tap **Reset the PIN with my code**. A PIN from before codes existed can get one: **Settings**, **Tax, hours and PIN**, **Make a recovery code**."
     },
     {
      "t": "p",
      "x": "No code? The only way back is to clear this site's saved data in your browser settings. That erases everything on this device. Do it only with a backup you can restore. A backup brings its PIN back, so use one made before it was set."
     },
     {
      "t": "p",
      "x": "With a PIN set, changing it or making a new recovery code asks for the current PIN. Five wrong tries lock the pad for 30 seconds. The PIN is a door latch, not security."
     },
     {
      "t": "h",
      "x": "Smokebox opens empty"
     },
     {
      "t": "p",
      "x": "That is by design for a new Smokebox. It starts with no dishes and never guesses. Add dishes under **Dishes and prices**. If it was full yesterday, see \"The tablet was replaced or cleared\" above."
     },
     {
      "t": "h",
      "x": "What is saved where"
     },
     {
      "t": "ul",
      "x": [
       "Tickets, dishes, settings and the PIN: in this browser on this device only.",
       "Sound, loudness, Day or Night and text size: on this device only.",
       "Only a backup file can be moved."
      ]
     }
    ]
   },
   {
    "id": "saved-data-that-cannot-be-read",
    "group": "guide",
    "title": "Saved data that cannot be read",
    "summary": "What to do when Smokebox says some of its saved data could not be read.",
    "blocks": [
     {
      "t": "h",
      "x": "A message at the top"
     },
     {
      "t": "p",
      "x": "If a message says some saved records could not be read and were left out, the data as it was is kept. Do not clear the browser data. Ask whoever set up Smokebox. If a full-screen message says the saved data could not be read, tap **Download the old data** or **Show the data so I can copy it**. Only then can you continue."
     },
     {
      "t": "h",
      "x": "A copy that was set aside"
     },
     {
      "t": "p",
      "x": "When Smokebox could not read your saved data at start-up, it kept the unreadable copy aside for 30 days and began with its last good copy. If that set-aside copy can be read now (for example after going back to a newer version), the Data page shows a card: **A copy of your kitchen was set aside**. It says when it was set aside and how many tickets and orders it holds."
     },
     {
      "t": "p",
      "x": "To bring it back, open Back office, Menu, prices and shop, then Data. In the card, tap **Save a backup of what is here now first** and check that the file arrived. Then type **RESTORE** and tap **Bring the set-aside copy back**. If a PIN is set, Smokebox asks for it first. Everything on this device is replaced by the set-aside copy. What was here before is kept for 7 days: tap **Undo this restore** to put it back."
     },
     {
      "t": "p",
      "x": "To forget the set-aside copy, tap **Throw the set-aside copy away**. Your kitchen as it is now is not touched, and the copy cannot be brought back."
     }
    ]
   },
   {
    "id": "trying-the-demo",
    "group": "guide",
    "title": "Watch the demo",
    "summary": "See Smokebox with food on it, without touching your own kitchen.",
    "blocks": [
     {
      "t": "ol",
      "x": [
       "On the welcome screen, or in the **Settings**, tap **Watch the demo**. Then tap **Watch the demo** again to confirm. Tap **Not now** to stay where you are.",
       "The demo opens with sample dishes, three fresh sample tickets and food in the cabinet, and it runs by itself: new orders arrive and a sample crew cooks and bumps them. A bar at the top says \"Demo\". Watch, or tap any dish to join in. A demo left open for hours starts fresh the next time.",
       "Nothing you do there reaches your own kitchen.",
       "Tap **Back to my kitchen** on the bar to return. Your own dishes and orders are as you left them."
      ]
     },
     {
      "t": "p",
      "x": "A backup made in the demo cannot be loaded into your own kitchen, and a real backup cannot be loaded into the demo. Smokebox refuses it and changes nothing."
     },
     {
      "t": "p",
      "x": "The demo kitchen is a barbecue restaurant. Yours can be anything. Sample numbers are made up. They are never your sales or your food."
     }
    ]
   },
   {
    "id": "questions-and-answers",
    "group": "guide",
    "title": "Questions and answers",
    "summary": "Short answers to the questions owners ask first.",
    "blocks": [
     {
      "t": "h",
      "x": "Is it only for barbecue?"
     },
     {
      "t": "p",
      "x": "No. A new Smokebox starts empty. You add your own dishes, rename the stations and choose whether you cook ahead. Only the demo is a barbecue kitchen."
     },
     {
      "t": "h",
      "x": "Does it need the internet?"
     },
     {
      "t": "p",
      "x": "No. Smokebox is one file and works without internet."
     },
     {
      "t": "h",
      "x": "Can two tablets share one board?"
     },
     {
      "t": "p",
      "x": "Not yet. Each device has its own board. Two tabs in the same browser on the same device stay in step."
     },
     {
      "t": "h",
      "x": "Does it charge cards?"
     },
     {
      "t": "p",
      "x": "No. It only writes down how an order was paid. Keep your card reader."
     },
     {
      "t": "h",
      "x": "Where is my data?"
     },
     {
      "t": "p",
      "x": "In this browser on this device. Save a backup every day at close."
     },
     {
      "t": "h",
      "x": "What does 86 mean?"
     },
     {
      "t": "p",
      "x": "Sold out or off the menu. The **86 board** lists what is out and why."
     },
     {
      "t": "h",
      "x": "What is a starter estimate?"
     },
     {
      "t": "p",
      "x": "A number that came with the app, such as a prep time or a cost. It is a guess until you replace it with your own."
     },
     {
      "t": "h",
      "x": "Does Smokebox know how long cold food may keep?"
     },
     {
      "t": "p",
      "x": "No. For cold food in a fridge you type the days it may stay and the hours it may be out. Smokebox counts against those numbers. Use the limits your local health department gives you."
     },
     {
      "t": "h",
      "x": "Why is there no Cabinet tab?"
     },
     {
      "t": "p",
      "x": "The Cabinet shows only when you tell Smokebox you cook food ahead. Tap **Settings**, then **Dishes and prices**, and tap **Yes, I cook ahead**."
     },
     {
      "t": "h",
      "x": "Can I try it without risking my data?"
     },
     {
      "t": "p",
      "x": "Yes. See Watch the demo."
     },
     {
      "t": "h",
      "x": "Can I change a price on an open order?"
     },
     {
      "t": "p",
      "x": "New tickets use the new price. Tickets already on the board keep theirs."
     },
     {
      "t": "h",
      "x": "Has it been used in a real kitchen?"
     },
     {
      "t": "p",
      "x": "It has been tested in a browser on a computer, not in a working kitchen. Try it on your own tablet before a busy service, and keep your usual system beside it until you trust it."
     }
    ]
   },
   {
    "id": "what-this-app-does-not-replace",
    "group": "guide",
    "title": "What this app does not replace",
    "summary": "Smokebox is a helper. You and your local rules stay in charge.",
    "blocks": [
     {
      "t": "ul",
      "x": [
       "Food-safety procedures. Smokebox reminds you to take temperatures and flags readings and times outside the limits you set. It cannot see, taste or measure your food. Smokebox writes down the cooler, freezer, thermometer and sanitizer strip readings you type under Readings. It cannot check them, and it may not be the record your health department asks for. Keep a paper log if they require one. Your own food-safety plan, your training and your thermometer checks still apply.",
       "Your local health code. The limits Smokebox starts with (such as each dish's hold time, 4 to 8 hours, and the check interval) are starting values, not your local rules. Set the limits your local health department gives you. The one reheat per batch is Smokebox's own fixed rule; if your local rule is stricter, follow it.",
       "Card processing. Smokebox only writes down how an order was paid. Keep your card reader and your processor.",
       "Your register or POS. Smokebox is a kitchen display with simple order entry. It does not file taxes, run payroll or replace your bookkeeping. Sales tax is one flat percent that you set.",
       "Allergy care. A note on a ticket is a reminder. Tell your staff about every allergy, and follow your own allergen rules.",
       "Your backups. If you do not save backups, clearing the browser data erases everything.",
       "Real numbers. Demo tickets and sample history are made up. Starter estimates for prep times, yields and costs are guesses until you confirm them."
      ]
     }
    ]
   },
   {
    "id": "card-opening-checklist",
    "group": "cards",
    "title": "Opening checklist",
    "summary": "Print this card and keep it by the tablet.",
    "blocks": [
     {
      "t": "check",
      "x": [
       "Tablet plugged in, and set to never sleep",
       "Volume up. Smokebox open on the kitchen board",
       "Tap the warning bar once, or use Test the sound under Device checks: screen, sound, home screen",
       "Check the 86 board: what is out today?",
       "Counted dishes: how many did you make today?",
       "Hand sink works and is stocked. Anyone unwell? Tell the manager",
       "Thermometer checked in ice water. Cooler and freezer readings written down (Settings, Readings, or your paper log)",
       "If you cook ahead: log a first temperature on each batch in the cabinet",
       "If you cook ahead: wipe food-contact surfaces and tap Sanitize",
       "Yesterday's backup saved and a copy kept off the device"
      ]
     }
    ]
   },
   {
    "id": "card-closing-checklist",
    "group": "cards",
    "title": "Closing checklist",
    "summary": "Print this card and keep it by the tablet.",
    "blocks": [
     {
      "t": "check",
      "x": [
       "Orders: every open order paid or cancelled, then Close the day",
       "If you cook ahead: every batch left in the cabinet decided (keep it, or throw it out)",
       "If you cook ahead: surfaces wiped and Sanitize logged",
       "Food kept over a day: labeled with a date, as your local rule says",
       "Final cooler and freezer readings written down",
       "Sales and money looks right in the Back office",
       "Log of thrown-out batches saved or printed",
       "Backup downloaded and a copy kept off the device",
       "Tablet on its charger"
      ]
     }
    ]
   },
   {
    "id": "card-when-something-goes-wrong",
    "group": "cards",
    "title": "When something goes wrong",
    "summary": "Print this card and keep it by the tablet.",
    "blocks": [
     {
      "t": "check",
      "x": [
       "No sound: tap the warning bar, turn the volume up, then Settings, Device checks: screen, sound, home screen, Test the sound",
       "Screen asleep: wake it and check the times on the cards. Set it to never sleep",
       "Wrong tap: Undo, within 10 seconds",
       "Bumped by mistake: Recall it from the board header",
       "Wrong ticket: cancel it with Void ticket in its small menu, and give a reason",
       "Dish missing: check the 86 board and Dishes and prices",
       "Opened empty: restore the last backup (Back office, Menu, prices and shop)",
       "Forgot the PIN: use your recovery code (Guide, Empty, lost or locked)"
      ]
     }
    ]
   },
   {
    "id": "card-first-day-checklist",
    "group": "cards",
    "title": "First day checklist",
    "summary": "Print this card. Check each box off with a pen.",
    "blocks": [
     {
      "t": "h",
      "x": "Before opening"
     },
     {
      "t": "check",
      "x": [
       "Dishes added, tax and hours set (Settings, Dishes and prices)",
       "Tablet plugged in, set to never sleep, volume up",
       "One test order sent and cancelled"
      ]
     },
     {
      "t": "h",
      "x": "During service"
     },
     {
      "t": "check",
      "x": [
       "On each ticket: Start, Done, then Bump",
       "Wrong tap? Undo, within 10 seconds",
       "Dish sold out? Mark it on the 86 board"
      ]
     },
     {
      "t": "h",
      "x": "Closing"
     },
     {
      "t": "check",
      "x": [
       "Every order paid or cancelled, then Close the day",
       "Backup saved, and a copy kept off the tablet"
      ]
     },
     {
      "t": "h",
      "x": "If something goes wrong"
     },
     {
      "t": "check",
      "x": [
       "Open the Guide. Troubleshooting covers sound and lost data"
      ]
     }
    ]
   },
   {
    "id": "card-tablet-setup",
    "group": "cards",
    "title": "Tablet setup",
    "summary": "Print this card and keep it with the tablet.",
    "blocks": [
     {
      "t": "check",
      "x": [
       "Open Smokebox and add it to the home screen: on an iPad tap Share, then Add to Home Screen. In Chrome tap the menu, then Install app",
       "Keep it awake: set Auto-Lock (iPad) or Screen timeout (Android) to Never, and plug it in",
       "Turn the volume up. Tap Settings, Device checks: screen, sound, home screen, then Test the sound",
       "Wifi: not needed. Smokebox works without internet",
       "Backups go where you save them: the Downloads folder, or an email to yourself. Smokebox does not send them anywhere",
       "Keep a copy of every backup off this tablet",
       "Replacing the tablet? Restore your newest backup (Guide, Replacing a device)"
      ]
     }
    ]
   },
   {
    "id": "card-during-service",
    "group": "cards",
    "title": "During service",
    "summary": "Print this card and keep it by the tablet. One side for cooks, one for the counter.",
    "blocks": [
     {
      "t": "h",
      "x": "Cooks"
     },
     {
      "t": "check",
      "x": [
       "A ticket arrives: read your dishes",
       "Tap Start when a timed dish begins",
       "Tap Done only when it is really finished",
       "Gray dish: waiting on purpose. Start now goes early",
       "Clock amber, then red: the order is late",
       "Sold out: tap Sold out (the 86 board) and mark it",
       "Cooked food leaves the cabinet: tap Pull",
       "Wrong tap: Undo, within 10 seconds",
       "Bumped by mistake: Recall, in the header"
      ]
     },
     {
      "t": "h",
      "x": "Counter and expo"
     },
     {
      "t": "check",
      "x": [
       "New ticket, tap the dishes, pick Dine-in or Takeout",
       "Allergy: tap Allergy and say which, first",
       "Customer waiting: switch on Rush ticket",
       "Cash or Card, then Send to kitchen. Or Pay later",
       "Every dish done: Bump",
       "Wrong ticket: Void ticket, with a reason",
       "Frozen or offline: reload the page. Orders are kept"
      ]
     }
    ]
   }
  ];
  // guide:data-end
  // audit:data-end

  // The page with this id, or the first page when the id is unknown or missing.
  const byId = (id) => PAGES.find((p) => p.id === id) || PAGES[0] || null;
  // Splits text into plain and bold pieces: [{ b: false, s: 'Tap ' }, { b: true, s: 'Pay' }, ...].
  function pieces(text) {
    return String(text).split(/\*\*([^*]+)\*\*/).map((s, i) => ({ b: i % 2 === 1, s })).filter((p) => p.s);
  }
  // The text with the bold marks removed, as a screen reader or a test would read it.
  const plain = (text) => pieces(text).map((p) => p.s).join('');
  // Every piece of text on a page, bold marks kept, in reading order (the alt text of a picture included).
  function textsOf(p) {
    return [p.title, p.summary].concat(p.blocks.map((b) => (Array.isArray(b.x) ? b.x.join(' ') : b.t === 'fig' ? b.alt + ' ' + b.cap : b.x)));
  }
  // The names of every button or screen the Guide mentions in bold, so a test can check they still exist.
  function labels() {
    const out = [];
    PAGES.forEach((p) => textsOf(p).forEach((t) => pieces(t).forEach((x) => { if (x.b && out.indexOf(x.s) < 0) out.push(x.s); })));
    return out;
  }
  // Searches the pages for every word typed (all words must appear). Returns [{ page, snippet }], best matches first:
  // a title hit ranks above a body hit.
  function search(query) {
    const words = String(query || '').toLowerCase().split(/[^a-z0-9$]+/).filter((w) => w.length > 1);
    if (!words.length) return [];
    const out = [];
    PAGES.forEach((p) => {
      const parts = textsOf(p).map(plain);
      const all = parts.join(' ').toLowerCase();
      if (!words.every((w) => all.indexOf(w) >= 0)) return;
      const title = p.title.toLowerCase();
      const score = words.filter((w) => title.indexOf(w) >= 0).length * 10 + words.reduce((n, w) => n + all.split(w).length - 1, 0);
      // The first heading, paragraph or list item that holds a typed word, for the line under the result.
      const units = [];
      p.blocks.forEach((bl) => { if (Array.isArray(bl.x)) units.push(...bl.x); else units.push(bl.t === 'fig' ? bl.alt : bl.x); });
      const hit = units.find((u) => words.some((w) => plain(u).toLowerCase().indexOf(w) >= 0)) || p.summary;
      out.push({ page: p, score, snippet: plain(hit).slice(0, 140) });
    });
    return out.sort((a, b) => b.score - a.score);
  }

  // Node (tests) has no page, so only the data and text helpers are offered there.
  if (!doc) { SB.guide = { pages: PAGES, byId, pieces, plain, labels, textsOf, search, link: () => null }; return; }

  const U = SB.util, h = U.h;
  // An icon of this name and size, or an empty span when icons are missing.
  const ico = (n, size) => { try { return SB.icons.svg(n, { size }); } catch (e) { return doc.createElement('span'); } };
  const R = () => SB.router;

  // The screen being shown, or null: { el, root, nav, main, article, page, ... }.
  let cur = null;

  // Makes the DOM for a piece of text, turning the bold marks into button-name chips.
  function inline(text) {
    const frag = doc.createDocumentFragment();
    pieces(text).forEach((p) => frag.appendChild(p.b ? h('strong', { class: 'gd-ui' }, p.s) : doc.createTextNode(p.s)));
    return frag;
  }
  // The address that opens one Guide page, so a link can be copied or bookmarked.
  const hashOf = (id) => (R() && R().hashFor ? R().hashFor({ kind: 'guide', page: id }) : '#/guide/' + id);
  // Goes to a Guide page through the router, which calls show() for us.
  const go = (id) => { if (R() && R().go) R().go({ kind: 'guide', page: id }); else show(id); };
  // Leaves the Guide and returns to the board (or the screen this device normally opens on).
  const back = () => { if (R() && R().go) R().go(R().home()); };
  // A click handler for a link to one page: moves there through the router instead of reloading the page.
  const linkClick = (id) => (e) => { e.preventDefault(); go(id); };

  // One block of a page (heading, paragraph, list, checklist or picture) as DOM.
  function block(b) {
    if (b.t === 'h') return h('h3', { class: 'gd-h' }, b.x);
    if (b.t === 'p') return h('p', { class: 'gd-p' }, inline(b.x));
    if (b.t === 'fig') {
      const art = SB.guideArt && SB.guideArt[b.id];
      if (!art) return h('p', { class: 'gd-p' }, b.alt);
      return h('figure', { class: 'gd-fig' }, art(b.alt), b.cap ? h('figcaption', null, b.cap) : null);
    }
    const tag = b.t === 'ol' ? 'ol' : 'ul';
    return h(tag, { class: 'gd-list' + (b.t === 'check' ? ' gd-check' : b.t === 'ol' ? ' gd-legend' : '') }, ...b.x.map((x) => h('li', null, inline(x))));
  }
  // Prints the page now showing. The print styles in 24-guide.css hide everything except the page text.
  const printNow = () => { try { g.print(); } catch (e) { /* printing is optional */ } };
  // Fills the content pane with one page: title, print button, summary, blocks and the Previous / Next links.
  function paint(page) {
    const a = cur.article;
    U.clear(a);
    const list = PAGES.filter((p) => p.group === page.group);
    const i = list.indexOf(page);
    const printBtn = h('button', { type: 'button', class: 'btn gd-print' + (page.group === 'cards' ? ' btn-primary' : ''), onClick: printNow }, ico('receipt', 20), h('span', null, page.group === 'cards' ? 'Print this card' : 'Print this page'));
    a.appendChild(h('div', { class: 'gd-head' }, h('h2', { class: 'gd-page-title', tabindex: -1 }, page.title), printBtn));
    a.appendChild(h('p', { class: 'gd-lede' }, inline(page.summary)));
    page.blocks.forEach((b) => a.appendChild(block(b)));
    const pager = h('div', { class: 'gd-pager' });
    // Builds a Previous or Next link to a neighbouring page.
    const link = (p, dir) => h('a', { class: 'btn gd-pg gd-pg-' + dir, href: hashOf(p.id), onClick: linkClick(p.id) },
      dir === 'prev' ? ico('chevron-left', 20) : null, h('span', null, (dir === 'prev' ? 'Previous: ' : 'Next: ') + p.title), dir === 'next' ? ico('chevron-right', 20) : null);
    if (i > 0) pager.appendChild(link(list[i - 1], 'prev'));
    if (i < list.length - 1) pager.appendChild(link(list[i + 1], 'next'));
    a.appendChild(pager);
  }
  // Marks the current page in the left list for sighted users and for screen readers.
  function markNav(page) {
    cur.nav.querySelectorAll('a').forEach((a) => {
      const on = a.getAttribute('data-page') === page.id;
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }

  // Shows one page (by id) in the open Guide: updates the list, the text, the title and the focus.
  function show(id) {
    if (!cur) return false;
    const page = byId(id);
    if (!page) return false;
    // An unknown page name in the address is tidied to the real first page, so the address never lies.
    if (id && page.id !== id && R() && R().go) R().go({ kind: 'guide', page: page.id }, { replace: true });
    cur.page = page;
    markNav(page);
    paint(page);
    cur.main.scrollTop = 0;
    // On a phone, fold the list again after choosing a page, and show the new page's name on the fold.
    if (cur.narrow && cur.narrow.matches) cur.box.open = false;
    cur.nav.querySelector('.gd-navsum').textContent = 'Pages: ' + page.title;
    if (!(cur.narrow && cur.narrow.matches)) cur.nav.querySelector('.gd-navsum').textContent = 'All pages and search';
    try { cur.article.querySelector('.gd-page-title').focus({ preventScroll: true }); } catch (e) { /* focus is a nicety */ }
    return true;
  }

  // One entry (a numbered link) in the page list.
  const navItem = (p, n) => h('li', null, h('a', { class: 'gd-link', href: hashOf(p.id), 'data-page': p.id, onClick: linkClick(p.id) },
    h('span', { class: 'gd-num', 'aria-hidden': 'true' }, String(n)), h('span', null, p.title)));
  // The list of pages (two groups: the Guide, and the printable quick cards).
  function buildList() {
    const guide = PAGES.filter((p) => p.group !== 'cards'), cards = PAGES.filter((p) => p.group === 'cards');
    return h('div', { class: 'gd-lists' },
      h('ol', { class: 'gd-nav-list' }, ...guide.map((p, i) => navItem(p, i + 1))),
      cards.length ? h('p', { class: 'gd-group', id: 'gd-cards-h' }, 'Quick cards to print') : null,
      cards.length ? h('ul', { class: 'gd-nav-list', 'aria-labelledby': 'gd-cards-h' }, ...cards.map((p) => navItem(p, '⎙'))) : null);
  }
  // Wires the search box: typing swaps the page list for matching pages; Enter opens the best match; Escape clears.
  function buildSearch(listBox) {
    const input = h('input', { type: 'search', class: 'input gd-search-in', id: 'gd-search', placeholder: 'Search the Guide', 'aria-label': 'Search the Guide', autocomplete: 'off' });
    const status = h('p', { class: 'gd-search-n', role: 'status', 'aria-live': 'polite' });
    const results = h('ul', { class: 'gd-results', hidden: true, 'aria-label': 'Search results' });
    // Redraws the results (or brings the page list back when the box is empty).
    function run() {
      const q = input.value.trim(), found = search(q);
      U.clear(results);
      listBox.hidden = !!q; results.hidden = !q;
      status.textContent = q ? (found.length ? found.length + (found.length === 1 ? ' page matches' : ' pages match') : 'No page matches. Try fewer or different words.') : '';
      found.forEach((f) => results.appendChild(h('li', null, h('a', { class: 'gd-result', href: hashOf(f.page.id), onClick: linkClick(f.page.id) }, h('strong', null, f.page.title), h('span', null, f.snippet)))));
    }
    input.addEventListener('input', run);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const first = results.querySelector('a'); if (first) { e.preventDefault(); first.click(); } }
      else if (e.key === 'Escape' && input.value) { e.preventDefault(); e.stopPropagation(); input.value = ''; run(); }
      else if (e.key === 'ArrowDown') { const first = results.querySelector('a'); if (first) { e.preventDefault(); first.focus(); } }
    });
    return h('div', { class: 'gd-search', role: 'search' }, h('label', { class: 'visually-hidden', for: 'gd-search' }, 'Search the Guide'), input, status, results);
  }

  // Closes the Guide on Escape, unless a pop-up sheet is open (then Escape belongs to the sheet).
  function onKey(e) { if (e.key === 'Escape' && !doc.querySelector('.sheet-root')) { e.preventDefault(); back(); } }

  // Builds the Guide screen inside el and shows the page named in opts.page. Returns a cleanup function.
  function mount(el, opts) {
    unmount();
    const listBox = buildList();
    // On a phone the list folds away so the page itself is the first thing seen; on wide screens it is always open.
    const sum = h('summary', { class: 'gd-navsum' }, 'All pages and search');
    const box = h('details', { class: 'gd-navbox' }, sum, buildSearch(listBox), listBox);
    const nav = h('nav', { class: 'gd-nav', 'aria-label': 'Guide pages' }, box);
    const narrow = g.matchMedia ? g.matchMedia('(max-width: 760px)') : null;
    // Opens the list on wide screens and folds it on narrow ones.
    const fit = () => {
      const small = !!(narrow && narrow.matches);
      box.open = !small;
      sum.textContent = small && cur && cur.page ? 'Pages: ' + cur.page.title : 'All pages and search';
    };
    fit();
    if (narrow && narrow.addEventListener) narrow.addEventListener('change', fit);
    const article = h('article', { class: 'gd-article' });
    const main = h('main', { class: 'gd-main', id: 'gd-main' }, article);
    const topBack = h('button', { type: 'button', class: 'btn gd-back', onClick: back }, ico('chevron-left', 20), h('span', null, 'Back to the board'));
    const top = h('header', { class: 'gd-top' }, topBack, h('h1', { class: 'gd-title' }, ico('info', 24), h('span', null, 'Guide')));
    // Keyboard users can jump past the page list straight to the page text.
    const skip = h('a', { class: 'gd-skip', href: '#gd-main', onClick: (e) => { e.preventDefault(); const t = article.querySelector('.gd-page-title'); if (t) t.focus(); } }, 'Skip to this page');
    const root = h('div', { class: 'gd' }, skip, top, h('div', { class: 'gd-body' }, nav, main));
    U.clear(el);
    el.appendChild(root);
    el.addEventListener('keydown', onKey);
    cur = { el, root, nav, main, article, box, narrow, fit, page: null };
    show(opts && opts.page);
    return unmount;
  }
  // Takes the Guide screen down and forgets it.
  function unmount() {
    if (!cur) return;
    const c = cur; cur = null;
    c.el.removeEventListener('keydown', onKey);
    if (c.narrow && c.narrow.removeEventListener) c.narrow.removeEventListener('change', c.fit);
    U.clear(c.el);
  }
  // True while the Guide screen is showing.
  function isOpen() { return !!cur; }

  // Opens the Guide (optionally at one page) by moving the address to #/guide or #/guide/page-name.
  function open(id) { go(id || (PAGES[0] && PAGES[0].id)); }

  // A small round "?" link that opens one Guide page; other screens place it next to a heading or button.
  // label says what the help is about ("Help: taking payment"), for screen readers and the tooltip.
  function link(page, label) {
    const name = label ? 'Help: ' + label : 'Help';
    return h('a', { class: 'gd-help', href: hashOf(page), title: name, 'aria-label': name, onClick: linkClick(page) }, h('span', { 'aria-hidden': 'true' }, '?'));
  }

  SB.guide = { pages: PAGES, ids: PAGES.map((p) => p.id), byId, pieces, plain, labels, textsOf, search, mount, unmount, show, open, isOpen, link };
})(typeof globalThis !== 'undefined' ? globalThis : window);
