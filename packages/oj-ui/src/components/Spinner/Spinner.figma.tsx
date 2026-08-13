import figma from '@figma/code-connect'
import { Spinner } from './Spinner'

figma.connect(Spinner, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=6-8', {
  example: () => (<Spinner />),
})
