/* global jest */
import mockSafeArea from 'react-native-safe-area-context/jest/mock';
jest.mock('react-native-safe-area-context', () => mockSafeArea);
