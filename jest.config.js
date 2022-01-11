module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testRunner: 'jest-jasmine2',
  moduleNameMapper: {
    "@exmpl/(.*)": "<rootDir>/src/$1"
  },
};

