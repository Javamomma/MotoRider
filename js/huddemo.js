// Sample frames for hud.html?demo — lets the glance view be checked without riding.

export function demoFrames() {
  const base = { v: 1, ts: 0, eta: '3:42 PM', ride: 'Sunday canyon loop', remainingM: 38200 };
  return [
    { ...base, state: 'navigating', next: { icon: 'right', text: 'Turn right onto Ridge Road.', distM: 4800 } },
    { ...base, state: 'navigating', next: { icon: 'right', text: 'Turn right onto Ridge Road.', distM: 750 } },
    { ...base, state: 'navigating', next: { icon: 'right', text: 'Turn right onto Ridge Road.', distM: 120 }, then: { icon: 'slight-left' } },
    { ...base, state: 'navigating', next: { icon: 'slight-left', text: 'Bear left onto Lefthand Canyon Drive.', distM: 90 } },
    { ...base, state: 'navigating', next: { icon: 'roundabout', text: 'Enter the roundabout and take the 2nd exit onto CO 72.', distM: 400 } },
    { ...base, state: 'offroute', next: { icon: 'left', text: 'Turn left onto Peak to Peak Highway.', distM: 300 } },
    { ...base, state: 'navigating', next: { icon: 'arrive', text: 'You have arrived at your destination.', distM: 60 } },
    { ...base, state: 'arrived', next: { icon: 'arrive', text: '', distM: 0 } },
  ];
}
