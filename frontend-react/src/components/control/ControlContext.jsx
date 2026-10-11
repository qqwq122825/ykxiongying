import { createContext, useContext } from 'react'

const ControlContext = createContext(null)

export const useControl = () => useContext(ControlContext)

export default ControlContext
