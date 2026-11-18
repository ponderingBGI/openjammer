import figma from '@figma/code-connect'
import { Cable } from './Cable'

figma.connect(Cable, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=16-14', {
  example: () => (
    <Cable kind="audio" start={{ x: 0, y: 0 }} end={{ x: 200, y: 40 }} signalLevel={0.6} />
  ),
})
