import figma from '@figma/code-connect'
import { Waveform } from './Waveform'

figma.connect(Waveform, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=16-33', {
  example: () => (<Waveform data={[0, 0.8, -0.4, 0]} showCenterLine />),
})
