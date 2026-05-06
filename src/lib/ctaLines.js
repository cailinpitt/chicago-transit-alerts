// CTA train line metadata. `color` is the official CTA brand hex.
// `textColor` is chosen for contrast on that background.
export const TRAIN_LINES = {
  red:  { label: 'Red',    color: '#C60C30', textColor: '#fff' },
  blue: { label: 'Blue',   color: '#00A1DE', textColor: '#fff' },
  brn:  { label: 'Brown',  color: '#62361B', textColor: '#fff' },
  g:    { label: 'Green',  color: '#009B3A', textColor: '#fff' },
  org:  { label: 'Orange', color: '#F9461C', textColor: '#fff' },
  pink: { label: 'Pink',   color: '#E27EA6', textColor: '#fff' },
  p:    { label: 'Purple', color: '#522398', textColor: '#fff' },
  y:    { label: 'Yellow', color: '#F9E300', textColor: '#000' },
};

// Order determines row order in the timeline grid.
export const TRAIN_LINE_ORDER = ['red', 'blue', 'brn', 'g', 'org', 'pink', 'p', 'y'];
