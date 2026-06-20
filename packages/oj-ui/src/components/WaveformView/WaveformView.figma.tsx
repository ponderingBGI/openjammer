import figma from '@figma/code-connect'
import { WaveformView } from './WaveformView'

figma.connect(WaveformView, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=18-53', {
  example: () => (<WaveformView />),
})
