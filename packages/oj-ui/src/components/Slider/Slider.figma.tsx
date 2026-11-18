import figma from '@figma/code-connect'
import { Slider } from './Slider'

figma.connect(Slider, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=9-2', {
  example: () => (<Slider aria-label="Gain" value={50} min={0} max={100} onChange={() => {}} />),
})
